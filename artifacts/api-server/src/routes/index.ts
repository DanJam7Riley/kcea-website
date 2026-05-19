import { Router, type IRouter } from "express";
import healthRouter from "./health";
import statsRouter from "./stats";
import captainsRouter from "./captains";
import commitmentsRouter from "./commitments";
import volunteersRouter from "./volunteers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(statsRouter);
router.use(captainsRouter);
router.use(commitmentsRouter);
router.use(volunteersRouter);

export default router;
