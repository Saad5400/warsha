<script>
  // `$state` makes a value reactive: when `count` changes, Svelte updates only
  // the parts of the page that use it.
  let count = $state(0);
</script>

<main class="card">
  <h1>Hello from Svelte</h1>
  <p>You clicked {count} time{count === 1 ? "" : "s"}.</p>
  <button onclick={() => count++}>Click me</button>
  <p class="hint">Change this text in <code>App.svelte</code>, then press Run.</p>
</main>

<style>
  /* Scoped to this component — Svelte rewrites these selectors so they only
     touch App.svelte's own markup. */
  .card {
    text-align: center;
    padding: 2rem 2.5rem;
    border-radius: 1rem;
    background: #1e293b;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .card h1 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
  }
  button {
    margin-top: 0.5rem;
    padding: 0.5rem 1.25rem;
    font: inherit;
    color: #fff;
    background: #ff3e00;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
  }
  button:hover {
    background: #e63700;
  }
  .hint {
    margin-top: 1rem;
    font-size: 0.85rem;
    color: #94a3b8;
  }
</style>
