// A component is a function that returns markup (JSX). `useState` gives it
// memory: each click updates `count`, and React re-renders only what changed.
import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="card">
      <h1>Hello from React</h1>
      <p>
        You clicked {count} time{count === 1 ? "" : "s"}.
      </p>
      <button onClick={() => setCount(count + 1)}>Click me</button>
      <p className="hint">
        Change this text in <code>App.tsx</code>, then press Run.
      </p>
    </main>
  );
}
