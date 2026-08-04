// JavaScript runs in the page. This finds the button and reacts to each click.

const button = document.querySelector("#count");
let clicks = 0;

button.addEventListener("click", () => {
  clicks += 1;
  button.textContent = "Clicked " + clicks + " time" + (clicks === 1 ? "" : "s");

  // console.log shows up in the Console tab, right beside the Preview.
  console.log("click number", clicks);
});

console.log("Page ready — click the button.");
