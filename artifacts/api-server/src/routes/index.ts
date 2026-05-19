import { Router, type IRouter } from "express";
import healthRouter from "./health";
import statsRouter from "./stats";
import captainsRouter from "./captains";
import commitmentsRouter from "./commitments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(statsRouter);
router.use(captainsRouter);
router.use(commitmentsRouter);

export default router;
