import { Router } from 'express';
import {
  getFriends,
  getPending,
  postRequest,
  postAccept,
  postReject,
  deleteFriend,
  getUserSearch,
} from '../controllers/friendsController.js';

const router = Router();

router.get('/', getFriends);
router.get('/pending', getPending);
router.get('/search', getUserSearch);
router.post('/request', postRequest);
router.post('/accept/:friendshipId', postAccept);
router.post('/reject/:friendshipId', postReject);
router.delete('/:userId', deleteFriend);

export default router;
