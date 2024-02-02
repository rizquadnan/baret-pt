"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validate_1 = require("../middlewares/validate");
const auth_schema_1 = require("../schemas/auth.schema");
const auth_controller_1 = require("../controllers/auth.controller");
const deserializeUser_1 = require("../middlewares/deserializeUser");
const requireUser_1 = require("../middlewares/requireUser");
const router = (0, express_1.Router)();
router.post("/register/:userType((trainer|customer))", (0, validate_1.validate)(auth_schema_1.registerUserSchema), auth_controller_1.registerUserHandler);
router.post("/login/:userType((trainer|customer))", (0, validate_1.validate)(auth_schema_1.loginUserSchema), auth_controller_1.loginUserHandler);
router.post("/refresh/:userType((trainer|customer))", auth_controller_1.refreshAccessTokenHandler);
router.post("/logout", auth_controller_1.logoutUserHandler);
router.post("/forgot_password/:userType((trainer|customer))", (0, validate_1.validate)(auth_schema_1.forgotPasswordSchema), auth_controller_1.forgotPasswordHandler);
router.patch("/reset_password/:userType((trainer|customer))/:resetToken", (0, validate_1.validate)(auth_schema_1.resetPasswordSchema), auth_controller_1.resetPasswordHandler);
router.patch("/change_password", (0, validate_1.validate)(auth_schema_1.changePasswordSchema), deserializeUser_1.deserializeUser, requireUser_1.requireUser, auth_controller_1.changePasswordHandler);
exports.default = router;
