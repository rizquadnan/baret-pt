import { CookieOptions, NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { generateJson } from "../utils/genJson";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  LoginUserInput,
  RegisterUserInput,
  AuthRouteParam,
  authResponseExcludedFields,
  UserType,
  ForgotPasswordInput,
} from "../schemas/user.schema";
import {
  createTrainer,
  findUniqueTrainerByEmail,
  findUniqueTrainerById,
  updateTrainer,
} from "../services/trainer.service";
import {
  createCustomer,
  findUniqueCustomerByEmail,
  findUniqueCustomerById,
  updateCustomer,
} from "../services/customer.service";
import { omit } from "lodash";
import AppError from "../utils/appError";
import { signJwt, signTokens, verifyJwt } from "../utils/jwt";
import config from "config";
import Email from "../utils/email";

const cookiesOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
};

if (process.env.NODE_ENV === "production") cookiesOptions.secure = true;

const accessTokenCookieOptions: CookieOptions = {
  ...cookiesOptions,
  maxAge: config.get<number>("accessTokenExpiresIn") * 60 * 1000, // config number * 1 minute
};

const refreshTokenCookieOptions: CookieOptions = {
  ...cookiesOptions,
  maxAge: config.get<number>("refreshTokenExpiresIn") * 60 * 1000, // config number * 1 minute
};

export const registerUserHandler = async (
  req: Request<AuthRouteParam, {}, RegisterUserInput>,
  res: Response,
  next: NextFunction
) => {
  // TODO: verification code via email
  // TODO: register via google
  try {
    const userType = req.params.userType;
    const hashedPassword = await bcrypt.hash(req.body.password, 12);

    const payload = {
      email: req.body.email,
      name: req.body.name,
      password: hashedPassword,
      rStatus: "ACTIVE" as Prisma.TrainerCreateInput["rStatus"],
      whatsapp: req.body.whatsapp,
    };

    const user = await (userType === "trainer"
      ? createTrainer(payload)
      : createCustomer(payload));

    return res.status(201).json(
      generateJson({
        status: "success",
        data: omit(user, authResponseExcludedFields),
      })
    );
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return res.status(409).json({
          status: "fail",
          message: "Email already exist, please use another email address",
        });
      }
    }
    next(err);
  }
};

export const loginUserHandler = async (
  req: Request<AuthRouteParam, {}, LoginUserInput>,
  res: Response,
  next: NextFunction
) => {
  // TODO: login via google
  try {
    const { email, password } = req.body;
    const userType = req.params.userType;

    const user = await (userType === "trainer"
      ? findUniqueTrainerByEmail(email.toLowerCase())
      : findUniqueCustomerByEmail(email.toLowerCase()));

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return next(new AppError(400, "Invalid email or password"));
    }

    const { access_token, refresh_token } = await signTokens(user.id);

    res.cookie("access_token", access_token, accessTokenCookieOptions);
    res.cookie("refresh_token", refresh_token, refreshTokenCookieOptions);
    res.cookie("logged_in", true, {
      ...accessTokenCookieOptions,
      httpOnly: false,
    });

    return res.status(200).json(
      generateJson({
        status: "success",
        data: {
          user: omit(user, authResponseExcludedFields),
          token: access_token,
        },
      })
    );
  } catch (error) {
    next(error);
  }
};

export const refreshAccessTokenHandler = async (
  req: Request<AuthRouteParam, {}, {}>,
  res: Response,
  next: NextFunction
) => {
  try {
    const refresh_token = req.cookies.refresh_token;

    const userType = req.params.userType;

    const message = "Could not refresh access token";

    if (!refresh_token) {
      return next(new AppError(403, message));
    }

    // Validate refresh token
    const decoded = verifyJwt<{ sub: number }>(
      refresh_token,
      "refreshTokenPublicKey"
    );

    if (!decoded) {
      return next(new AppError(403, message));
    }

    const user = await (userType === "trainer"
      ? findUniqueTrainerById(decoded.sub)
      : findUniqueCustomerById(decoded.sub));

    if (!user) {
      return next(new AppError(403, message));
    }

    // Sign new access token
    const access_token = signJwt({ sub: user.id }, "accessTokenPrivateKey", {
      expiresIn: `${config.get<number>("accessTokenExpiresIn")}m`,
    });

    // 4. Add Cookies
    res.cookie("access_token", access_token, accessTokenCookieOptions);
    res.cookie("logged_in", true, {
      ...accessTokenCookieOptions,
      httpOnly: false,
    });

    // 5. Send response
    res.status(200).json({
      status: "success",
      access_token,
    });
  } catch (err: any) {
    next(err);
  }
};

export const forgotPasswordHandler = async (
  req: Request<AuthRouteParam, {}, ForgotPasswordInput>,
  res: Response,
  next: NextFunction
) => {
  try {
    const userType = req.params.userType;

    // Get the user from the collection
    const user = await (userType === "trainer"
      ? findUniqueTrainerByEmail(req.body.email)
      : findUniqueCustomerByEmail(req.body.email));

    const message =
      "You will receive a reset email if user with that email exist";
    if (!user) {
      console.log('User not found.')
      return res.status(200).json({
        status: "success",
        message,
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const passwordResetToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    await (userType === "trainer"
      ? updateTrainer(
          { id: user.id },
          {
            passwordResetToken,
            passwordResetAt: new Date(Date.now() + 10 * 60 * 1000),
          },
          { email: true }
        )
      : updateCustomer(
          { id: user.id },
          {
            passwordResetToken,
            passwordResetAt: new Date(Date.now() + 10 * 60 * 1000),
          },
          { email: true }
        ));

    try {
      const url = `${config.get<string>("origin")}/resetpassword/${resetToken}`;
      await new Email(user, url).sendPasswordResetToken();

      res.status(200).json({
        status: "success",
        message,
      });
    } catch (err: any) {
      userType === "trainer"
        ? await updateTrainer(
            { id: user.id },
            { passwordResetToken: null, passwordResetAt: null },
            {}
          )
        : await updateCustomer(
            { id: user.id },
            { passwordResetToken: null, passwordResetAt: null },
            {}
          );
      return res.status(500).json({
        status: "error",
        message: "There was an error sending email",
      });
    }
  } catch (err: any) {
    next(err);
  }
};