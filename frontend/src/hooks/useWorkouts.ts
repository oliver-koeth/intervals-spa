/**
 * useWorkouts — fetch the workout list from the backend.
 */
import { useEffect, useState } from "react";
import { workoutsApi, ApiError } from "../api/client";
import type { WorkoutResponse } from "../types/api";

interface State {
  workouts: WorkoutResponse[];
  loading: boolean;
  error: string | null;
}

export function useWorkouts(): State {
  const [state, setState] = useState<State>({
    workouts: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    workoutsApi
      .list()
      .then((data) => {
        if (!cancelled) setState({ workouts: data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            workouts: [],
            loading: false,
            error: err instanceof ApiError ? err.message : "Unknown error",
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
