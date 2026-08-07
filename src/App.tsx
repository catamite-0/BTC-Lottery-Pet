import AppShell from "./app/shell/AppShell";
import { useAppRuntime } from "./app/state/useAppRuntime";

function App() {
  const runtime = useAppRuntime();
  return <AppShell {...runtime} />;
}

export default App;
