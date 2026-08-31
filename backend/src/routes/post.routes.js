import { Router } from 'express';
import * as post from '../controllers/post.controller.js';
import * as comment from '../controllers/comment.controller.js';
import { authenticate, optionalAuth, requireVerified } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/index.js';

const router = Router();

/* Registered ahead of the session gate on purpose: a shared post has to open
   for whoever was sent the link, account or not. It answers with a public post
   and nothing else — see sharedPost. */
router.get('/:id/shared', optionalAuth, post.sharedPost);

router.use(authenticate, requireVerified);

/* Fixed segments before `/:id`, or Express hands "feed" to getPost as an id. */
router.get('/feed', post.homeFeed);
router.get('/explore', post.explore);
router.get('/saved', post.savedPosts);
router.get('/trending', post.trendingTags);
router.get('/user/:userId', post.byUser);

router.post('/', validate(v.postSchema), post.createPost);

/* Comment sub-resources are addressed by their own id, so they sit above the
   post routes that would otherwise swallow the path. */
router.get('/comments/:commentId/replies', comment.listReplies);
router.delete('/comments/:commentId', comment.deleteComment);
router.post('/comments/:commentId/like', comment.likeComment);
router.delete('/comments/:commentId/like', comment.unlikeComment);

router.get('/:id', post.getPost);
router.patch('/:id', validate(v.postUpdateSchema), post.updatePost);
router.delete('/:id', post.deletePost);

router.post('/:id/like', post.likePost);
router.delete('/:id/like', post.unlikePost);
router.get('/:id/likes', post.postLikers);

router.post('/:id/save', post.savePost);
router.delete('/:id/save', post.unsavePost);

router.delete('/:id/repost', post.unrepost);
router.post('/:id/share', post.sharePost);
router.post('/:id/view', post.viewPost);

router.get('/:id/comments', comment.listComments);
router.post('/:id/comments', validate(v.commentSchema), comment.addComment);

export default router;
