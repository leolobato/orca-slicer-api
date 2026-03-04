import { Router } from "express";
import { systemProfiles } from "../../services/system-profiles.service";
import { AppError } from "../../middleware/error";
import type { ProfileType } from "../slicing/models";

const router = Router();

const VALID_TYPES = new Set<string>(["machine", "process", "filament"]);

function validateType(type: string): ProfileType {
  if (!VALID_TYPES.has(type)) {
    throw new AppError(
      400,
      `Invalid profile type "${type}". Must be one of: machine, process, filament`
    );
  }
  return type as ProfileType;
}

router.get("/:type", async (req, res) => {
  const type = validateType(req.params.type);
  const manufacturer = req.query.manufacturer as string | undefined;

  const profiles = systemProfiles.list(type, { manufacturer });
  res.json(profiles);
});

router.get("/:type/:id", async (req, res) => {
  const type = validateType(req.params.type);
  const id = req.params.id;

  // Try exact name match first (returns single profile)
  const byName = systemProfiles.resolveByName(type, id);
  if (byName) {
    res.json(byName);
    return;
  }

  // Fall back to setting_id match (returns array — may match multiple profiles)
  const bySettingId = systemProfiles.resolveBySettingId(type, id);
  if (bySettingId.length > 0) {
    res.json(bySettingId);
    return;
  }

  throw new AppError(
    404,
    `Profile "${id}" not found for type "${type}"`
  );
});

export default router;
