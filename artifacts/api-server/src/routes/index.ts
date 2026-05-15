import { Router, type IRouter } from "express";
import healthRouter from "./health";
import statsRouter from "./stats";
import captainsRouter from "./captains";

const router: IRouter = Router();

router.use(healthRouter);
router.use(statsRouter);
router.use(captainsRouter);

export default router;
