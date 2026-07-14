/**
 * TypeScript types mirroring the Python application/contracts.py DTOs.
 * Keep in sync with the backend contract shapes.
 */

export type IntensityZone = "z1" | "z2" | "z3" | "z4" | "z5";
export type TrainingType = "cycling" | "running" | "swimming" | "strength" | "other";
export type WorkoutStatus = "planned" | "completed" | "skipped";

export interface IntervalRequest {
  zone: IntensityZone;
  duration_seconds: number;
  target_watts?: number;
}

export interface IntervalResponse {
  zone: IntensityZone;
  duration_seconds: number;
  target_watts?: number;
}

export interface WorkoutRequest {
  name: string;
  training_type: TrainingType;
  planned_date: string; // ISO date "YYYY-MM-DD"
  intervals?: IntervalRequest[];
}

export interface WorkoutResponse {
  id: string;
  name: string;
  training_type: TrainingType;
  planned_date: string;
  status: WorkoutStatus;
  total_duration_seconds: number;
  intervals: IntervalResponse[];
}
