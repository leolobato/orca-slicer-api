import { promises as fs } from "fs";
import * as path from "path";
import type { ProfileType } from "../routes/slicing/models";

interface ProfileEntry {
  name: string;
  setting_id?: string;
  type: ProfileType;
  manufacturer: string;
  raw: Record<string, unknown>;
}

interface ProfileIndex {
  byName: Map<string, ProfileEntry>;
  bySettingId: Map<string, ProfileEntry>;
}

const STRIP_KEYS = new Set(["inherits", "instantiation"]);

const TYPE_DIR_MAP: Record<string, ProfileType> = {
  machine: "machine",
  process: "process",
  filament: "filament",
};

class SystemProfilesService {
  private index: Record<ProfileType, ProfileIndex> = {
    machine: { byName: new Map(), bySettingId: new Map() },
    process: { byName: new Map(), bySettingId: new Map() },
    filament: { byName: new Map(), bySettingId: new Map() },
  };

  private resolveCache: Map<string, Record<string, unknown>> = new Map();
  private allRawByName: Map<string, Record<string, unknown>> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    const orcaPath = process.env.ORCASLICER_PATH;
    if (!orcaPath) {
      console.warn(
        "ORCASLICER_PATH not set, system profiles will not be available"
      );
      return;
    }

    // OrcaSlicer AppImage extracts to squashfs-root, resources/profiles is relative
    const profilesRoot = path.join(
      path.dirname(orcaPath),
      "resources",
      "profiles"
    );

    try {
      await fs.access(profilesRoot);
    } catch {
      console.warn(`Profiles directory not found at ${profilesRoot}`);
      return;
    }

    await this.scanProfilesDirectory(profilesRoot);
    this.initialized = true;

    const counts = {
      machine: this.index.machine.byName.size,
      process: this.index.process.byName.size,
      filament: this.index.filament.byName.size,
    };
    console.log(
      `System profiles loaded: ${counts.machine} machine, ${counts.process} process, ${counts.filament} filament`
    );
  }

  private async scanProfilesDirectory(profilesRoot: string): Promise<void> {
    const manufacturers = await fs.readdir(profilesRoot, {
      withFileTypes: true,
    });

    for (const mfr of manufacturers) {
      if (!mfr.isDirectory()) continue;

      const mfrDir = path.join(profilesRoot, mfr.name);

      for (const [dirName, profileType] of Object.entries(TYPE_DIR_MAP)) {
        const typeDir = path.join(mfrDir, dirName);
        try {
          await fs.access(typeDir);
        } catch {
          continue;
        }

        const files = await fs.readdir(typeDir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;

          try {
            const content = await fs.readFile(path.join(typeDir, file), "utf-8");
            const data = JSON.parse(content) as Record<string, unknown>;
            const name = (data.name as string) || file.replace(".json", "");

            this.allRawByName.set(name, data);

            const entry: ProfileEntry = {
              name,
              setting_id: data.setting_id as string | undefined,
              type: profileType,
              manufacturer: mfr.name,
              raw: data,
            };

            this.index[profileType].byName.set(name, entry);

            if (entry.setting_id) {
              this.index[profileType].bySettingId.set(entry.setting_id, entry);
            }
          } catch (err) {
            console.warn(`Failed to load profile ${file}: ${err}`);
          }
        }
      }
    }
  }

  resolve(
    type: ProfileType,
    nameOrSettingId: string
  ): Record<string, unknown> | null {
    if (!this.initialized) return null;

    const idx = this.index[type];
    const entry = idx.byName.get(nameOrSettingId) ??
      idx.bySettingId.get(nameOrSettingId);

    if (!entry) return null;

    return this.resolveInheritance(entry.name);
  }

  private resolveInheritance(name: string): Record<string, unknown> | null {
    if (this.resolveCache.has(name)) {
      return this.resolveCache.get(name)!;
    }

    const raw = this.allRawByName.get(name);
    if (!raw) return null;

    const parentName = raw.inherits as string | undefined;
    let resolved: Record<string, unknown>;

    if (parentName && this.allRawByName.has(parentName)) {
      const parent = this.resolveInheritance(parentName);
      if (parent) {
        resolved = { ...parent, ...raw };
      } else {
        resolved = { ...raw };
      }
    } else {
      resolved = { ...raw };
    }

    // Strip inheritance metadata from the resolved result
    for (const key of STRIP_KEYS) {
      delete resolved[key];
    }

    this.resolveCache.set(name, resolved);
    return resolved;
  }

  list(
    type: ProfileType,
    options?: { manufacturer?: string }
  ): Array<{ name: string; setting_id?: string; manufacturer: string }> {
    if (!this.initialized) return [];

    const entries = Array.from(this.index[type].byName.values());

    const filtered = options?.manufacturer
      ? entries.filter(
          (e) =>
            e.manufacturer.toLowerCase() ===
            options.manufacturer!.toLowerCase()
        )
      : entries;

    // Only return instantiable (leaf) profiles
    return filtered
      .filter((e) => e.raw.instantiation === "true")
      .map((e) => ({
        name: e.name,
        setting_id: e.setting_id,
        manufacturer: e.manufacturer,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const systemProfiles = new SystemProfilesService();
