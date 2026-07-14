# Domain Model — `intervals-spa`

## 1. Enumerations

### IntensityZone

Canonical training zones — five-zone model.

| Value | Name        | Description                 |
|-------|-------------|-----------------------------|
| `z1`  | Recovery    | Easy aerobic / active rest  |
| `z2`  | Endurance   | Aerobic base                |
| `z3`  | Tempo       | Sustained effort            |
| `z4`  | Threshold   | Lactate threshold           |
| `z5`  | VO2max      | VO2max / anaerobic          |

### TrainingType

| Value      | Description    |
|------------|----------------|
| `cycling`  | Road or indoor cycling |
| `running`  | Road, trail, or track running |
| `swimming` | Pool or open water |
| `strength` | Weight training or resistance work |
| `other`    | Any other modality |

### WorkoutStatus

| Value       | Description                      |
|-------------|----------------------------------|
| `planned`   | Scheduled but not yet done       |
| `completed` | Performed as planned             |
| `skipped`   | Intentionally missed             |

---

## 2. Domain Entities

### Interval

A single block of effort within a workout.

| Field              | Type          | Constraints                        |
|--------------------|---------------|------------------------------------|
| `zone`             | `IntensityZone` | Required; one of Z1–Z5           |
| `duration_seconds` | `int`         | Required; `> 0`                    |
| `target_watts`     | `int \| None` | Optional; `>= 0` when provided     |

**Invariants:**
- `duration_seconds` must be positive.
- `target_watts` must be non-negative when provided.

### Workout

A planned or completed training session composed of zero or more intervals.

| Field                    | Type              | Constraints             |
|--------------------------|-------------------|-------------------------|
| `id`                     | `UUID`            | System-assigned         |
| `name`                   | `str`             | Non-blank               |
| `training_type`          | `TrainingType`    | Required                |
| `planned_date`           | `date`            | Required                |
| `status`                 | `WorkoutStatus`   | Default `planned`       |
| `intervals`              | `list[Interval]`  | May be empty            |
| `total_duration_seconds` | `int` (computed)  | Sum of interval durations |

**Invariants:**
- `name` must not be blank.
- Each contained interval must satisfy `Interval` invariants.

---

## 3. Application Boundary Contracts

### WorkoutRequest (create/update input)

```json
{
  "name": "string (non-blank)",
  "training_type": "cycling | running | swimming | strength | other",
  "planned_date": "YYYY-MM-DD",
  "intervals": [
    {
      "zone": "z1 | z2 | z3 | z4 | z5",
      "duration_seconds": "integer > 0",
      "target_watts": "integer >= 0 | null"
    }
  ]
}
```

### WorkoutResponse (API output)

```json
{
  "id": "UUID string",
  "name": "string",
  "training_type": "cycling | ...",
  "planned_date": "YYYY-MM-DD",
  "status": "planned | completed | skipped",
  "total_duration_seconds": "integer",
  "intervals": [
    {
      "zone": "z1 | ...",
      "duration_seconds": "integer",
      "target_watts": "integer | null"
    }
  ]
}
```

---

## 4. Error Hierarchy

```
IntervalsError
├── ValidationError     (HTTP 400 / exit 2) — schema / semantic input failures
├── DomainRuleError     (HTTP 422 / exit 3) — domain invariant violations
├── NotFoundError       (HTTP 404 / exit 3) — resource not found
└── InfrastructureError (HTTP 500 / exit 4) — I/O / persistence failures
```

---

## 5. Units Policy

| Field                    | Unit    |
|--------------------------|---------|
| `duration_seconds`       | seconds |
| `target_watts`           | watts   |
| `total_duration_seconds` | seconds |
| `planned_date`           | ISO 8601 date (`YYYY-MM-DD`) |
