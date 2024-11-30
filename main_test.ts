import { assertEquals } from "jsr:@std/assert";
// import { add } from "./main.ts";


function add(x: number, y: number): number {
  return x+y;
}

Deno.test(function addTest() {
  assertEquals(add(2, 3), 5);
});






