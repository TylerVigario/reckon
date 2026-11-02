// A recipe card, from press's recipe template. It imports press and applies recipe(), which sets
// the card page and the head; the rest is placeholder for your own. Use it as it is, apply your
// repository's own template that wraps recipe(), or copy recipe() into your repository and
// change your copy: press prefers none of them.
//
//   sh third_party/press/tools/new.sh recipes/<name> recipe    (or `just new recipes/<name> recipe`)
//
// copies it to recipes/<name>/main.typ, with the import below rewritten to where press sits.
// In press's own tree the import is relative, ../lib.typ, so the starter compiles there.
//
// What only you can supply, a name, a date, an address, is marked unsourced(): it prints in
// red, and every build says how many are left until each is replaced. The rest is an example to
// rewrite.
//
// ---------------------------------------------------------------------------
// What a card here does:
//
//   1. PAGE ONE IS THE WHOLE COOK. The ingredients and the method, and nothing a cook at the
//      stove has to turn the page for. <depth> starts everything else on a page of its own.
//   2. THE HEAD SAYS WHAT YOU ARE IN FOR: how much it makes, how it is cooked, how long it
//      takes. One line under it says what the dish is.
//   3. THE COSTLY STEPS STAND OUT. A step a mistake ruins is coloured warn; the one move the
//      dish turns on gets a callout, and only one.
//   4. IT KEEPS WHAT YOU LEARN. The last lines are for writing on: what you changed, and what
//      happened.
//
// Delete the parts a card does not use: the troubleshooting sheet, the callout.
// ---------------------------------------------------------------------------

#import "../lib.typ": *

#show: recipe.with(
  title: unsourced[Dish name],
  author: "Your name",
  yield: unsourced[serves 4],
  method: unsourced[stovetop],
  time: unsourced[about 30 min],
  intro: [One line on what this is, and when to make it.],
)

= Ingredients — gather first

#sheet((auto, 1fr), ([Item], [Amount]), size: sz.fine,
  [First ingredient], [1 cup],
  [Second ingredient], [2 tbsp],
  [Third ingredient], [to taste],
)
#v(8pt)

= Method — in order

#item(1, [First step])[What to do, and how you know it is done.]
#item(2, [The step a mistake ruins], color: warn)[What goes wrong, and how to keep it from going wrong.]
#item(3, [Last step])[How to serve it, or keep it.]

#callout(tone: "warn", label: [The move that matters])[The one thing the dish turns on.]

= Reference <depth>

== Notes and swaps

#units(
  unit([A swap], "note")[What to use instead.][What changes when you do.],
  unit([Keeping], "ok")[How long it keeps, and where.][How to warm it again.],
)
#v(8pt)

== Troubleshooting

#sheet((auto, 1fr), ([Problem], [Cause and fix]),
  [A problem], [Its cause, and what to do about it.],
)
#v(8pt)

== Your tweaks — write what you changed and what happened

#writein(3, label: [date])
