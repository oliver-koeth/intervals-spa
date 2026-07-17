/**
 * Typed API client for the intervals-spa backend.
 * All fetch calls go through this module — components must not call fetch directly.
 */

import type {
  WorkoutRequest,
  WorkoutResponse,
} from "../types/api";

const BASE = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const workoutsApi = {
  list: () => request<WorkoutResponse[]>("/workouts"),
  get: (id: string) => request<WorkoutResponse>(`/workouts/${id}`),
  create: (body: WorkoutRequest) =>
    request<WorkoutResponse>("/workouts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// Re-export types so callers can import from one place.
export type { WorkoutRequest, WorkoutResponse, IntervalRequest, IntervalResponse } from "../types/api";
