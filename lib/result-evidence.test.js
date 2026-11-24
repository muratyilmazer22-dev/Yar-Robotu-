const test = require("node:test");
const assert = require("node:assert/strict");
const { hasFinishOrder } = require("./result-evidence");

test("accepts an explicit result table header", () => {
  assert.equal(hasFinishOrder("At No\tAt Adı\tSıra\n1\tÖrnek At\t1"), true);
});

test("accepts Turkish program-number headers when the finish order is explicit", () => {
  assert.equal(hasFinishOrder("N\tAt İsmi\tSıra\n1\tÖrnek At\t1"), true);
});

test("accepts English result headers", () => {
  assert.equal(hasFinishOrder("Horse No | Horse Name | Position\n1 | Example | 1"), true);
});

test("rejects a normal race bulletin without finish-order columns", () => {
  assert.equal(hasFinishOrder("At No\tAt İsmi\tJokey\tSiklet\tHP\n1\tÖrnek At\tJokey Adı\t58\t72"), false);
});

test("does not accept a result word in prose as a table header", () => {
  assert.equal(hasFinishOrder("Sonuçlar ve tahminler\n1. Koşu 14:00\nAt No\tAt Adı\tJokey"), false);
});
