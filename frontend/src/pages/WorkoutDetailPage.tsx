import { useParams } from "react-router-dom";

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <h1>Workout Detail</h1>
      <p>Workout detail for <code>{id}</code> will be implemented here.</p>
    </div>
  );
}
