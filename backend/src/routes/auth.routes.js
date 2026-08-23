import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, otpLimiter } from '../middleware/rateLimit.js';
import * as v from '../validators/index.js';

const router = Router();

router.get('/check-email', auth.checkEmail);
router.get('/check-username', auth.checkUsername);
router.get('/identity', auth.getIdentityBlob);

router.post('/register', otpLimiter, validate(v.registerSchema), auth.register);
router.post('/verify-email', authLimiter, validate(v.verifyEmailSchema), auth.verifyEmail);
router.post('/resend-code', otpLimiter, validate(v.resendSchema), auth.resendCode);
router.post('/login', authLimiter, validate(v.loginSchema), auth.login);
router.post('/refresh', auth.refresh);
router.post('/logout', authenticate, auth.logout);

router.post('/forgot-password', otpLimiter, validate(v.forgotSchema), auth.forgotPassword);
router.post('/reset-password', authLimiter, validate(v.resetSchema), auth.resetPassword);
router.post('/change-password', authenticate, validate(v.changePasswordSchema), auth.changePassword);

router.get('/me', authenticate, auth.me);

export default router;
