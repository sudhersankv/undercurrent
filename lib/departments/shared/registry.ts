import type {
  DeptId,
  PilotInput,
  PilotOutput,
  SonarInput,
  SonarOutput,
  SoundingInput,
  SoundingOutput,
  SwarmInput,
  SwarmOutput,
  TideInput,
  TideOutput,
  WakeInput,
  WakeOutput,
} from "@/lib/contracts";
import { pilot } from "../pilot";
import { sonar } from "../sonar";
import { sounding } from "../sounding";
import { swarm } from "../swarm";
import { tide } from "../tide";
import { wake } from "../wake";
import type { Department } from "./types";

export interface DepartmentRegistry {
  sonar: Department<SonarInput, SonarOutput>;
  swarm: Department<SwarmInput, SwarmOutput>;
  sounding: Department<SoundingInput, SoundingOutput>;
  pilot: Department<PilotInput, PilotOutput>;
  tide: Department<TideInput, TideOutput>;
  wake: Department<WakeInput, WakeOutput>;
}

export const departments: DepartmentRegistry = { sonar, swarm, sounding, pilot, tide, wake };

export function getDepartment<K extends DeptId>(id: K): DepartmentRegistry[K] {
  return departments[id];
}
