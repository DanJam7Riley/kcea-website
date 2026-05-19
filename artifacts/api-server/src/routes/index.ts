import { Router, type IRouter } from "express";
import healthRouter from "./health";
import statsRouter from "./stats";
import captainsRouter from "./captains";
import commitmentsRouter from "./commitments";
import volunteersRouter from "./volunteers";
import captainPortalRouter from "./captain-portal";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(statsRouter);
router.use(settingsRouter);
router.use(captainsRouter);
router.use(commitmentsRouter);
router.use(volunteersRouter);
router.use(captainPortalRouter);

export default router;
