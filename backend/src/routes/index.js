import { Router } from 'express';
import authRoutes from './auth.routes.js';
import deviceRoutes from './device.routes.js';
import keysRoutes from './keys.routes.js';
import conversationRoutes from './conversation.routes.js';
import messageRoutes from './message.routes.js';
import userRoutes from './user.routes.js';
import uploadRoutes from './upload.routes.js';
import storyRoutes from './story.routes.js';
import linkRoutes from './link.routes.js';

const router = Router();

router.get('/', (_req, res) =>
  res.json({
    name: 'Chax API',
    version: '1.0.0',
    docs: '/api/health',
    encryption: 'end-to-end (AES-GCM-256 + ECDH P-256)',
  })
);

router.use('/auth', authRoutes);
router.use('/devices', deviceRoutes);
router.use('/keys', keysRoutes);
router.use('/conversations', conversationRoutes);
router.use('/messages', messageRoutes);
router.use('/users', userRoutes);
router.use('/uploads', uploadRoutes);
router.use('/stories', storyRoutes);
router.use('/links', linkRoutes);

export default router;
