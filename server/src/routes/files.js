import { Router } from 'express';
import {
  getMyFiles,
  getSharedWithMe,
  postShare,
  deleteShare,
  getDownload,
  deleteFile,
  postUpload,
  getJobStatusHandler,
  cancelJobHandler,
} from '../controllers/filesController.js';

const router = Router();

router.post('/upload', postUpload);
router.get('/mine', getMyFiles);
router.get('/shared-with-me', getSharedWithMe);
router.get('/jobs/:jobId', getJobStatusHandler);
router.delete('/jobs/:jobId', cancelJobHandler);
router.post('/:fileId/share', postShare);
router.delete('/:fileId/share/:userId', deleteShare);
router.get('/:fileId/download', getDownload);
router.delete('/:fileId', deleteFile);

export default router;
