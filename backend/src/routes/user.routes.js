import { Router } from 'express';
import * as user from '../controllers/user.controller.js';
import * as safety from '../controllers/safety.controller.js';
import { authenticate, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { handleUpload, uploadAvatar, setBucket } from '../middleware/upload.js';
import * as v from '../validators/index.js';

const router = Router();
router.use(authenticate, requireVerified);

router.get('/search', user.searchUsers);

router.get('/contacts', user.listContacts);
router.post('/contacts', validate(v.contactSchema), user.addContact);
router.delete('/contacts/:id', user.removeContact);

router.get('/blocked', user.listBlocked);

/* Community scam reports. Reputation is readable by anyone signed in, because
   the whole point is warning the next person — but filing one requires having
   been messaged, and reporters are never disclosed. */
router.get('/reports/mine', safety.myReports);
router.get('/:id/reputation', safety.reputation);
router.post('/:id/report', validate(v.scamReportSchema), safety.reportUser);
router.delete('/:id/report', safety.withdrawReport);
router.post('/block/:id', user.blockUser);
router.delete('/block/:id', user.unblockUser);

router.patch('/me', validate(v.profileSchema), user.updateProfile);
router.patch('/me/settings', user.updateSettings);
router.patch('/me/privacy', user.updatePrivacy);
router.post('/me/avatar', setBucket('avatars'), handleUpload(uploadAvatar), user.uploadAvatarImage);
router.delete('/me/avatar', user.removeAvatar);
router.delete('/me', user.deleteAccount);

router.get('/:id', user.getUser);

export default router;
