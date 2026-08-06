<script setup>
// `ref` makes a value reactive: when `count.value` changes, Vue updates the
// parts of the template that use it. In the template you just write `count`.
import { ref } from "vue";

const count = ref(0);
</script>

<template>
  <main class="card">
    <h1>Hello from Vue</h1>
    <p>You clicked {{ count }} time{{ count === 1 ? "" : "s" }}.</p>
    <button @click="count++">Click me</button>
    <p class="hint">Change this text in <code>App.vue</code>, then press Run.</p>
  </main>
</template>

<style scoped>
/* `scoped` means these styles apply only to this component's markup. */
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
  background: #42b883;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
}
button:hover {
  background: #369870;
}
.hint {
  margin-top: 1rem;
  font-size: 0.85rem;
  color: #94a3b8;
}
</style>
