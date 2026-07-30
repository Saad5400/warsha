# Java 04 — Two classes and your own package

**Goal:** Build your own package folder with two classes, where one class extends the other.
This is the first exercise where you create files, not only edit `Main.java`.

## Starter code

Start from the **Java (OOP starter)** template, or create these files yourself.
You need three files in two folders:

```
app/Main.java
models/Book.java
models/EBook.java
```

File: `models/Book.java` (fill in the rest)

```java
package models;

public class Book {
    private String title;
    private String author;
    private int pages;

    public Book(String title, String author, int pages) {
        // Store the three values in the fields.
    }

    public String getTitle() {
        return title;
    }

    public int getPages() {
        return pages;
    }

    public String describe() {
        // Return: "Kalila wa Dimna" by Ibn al-Muqaffa (192 pages)
        return "";
    }
}
```

## Tasks

1. Finish `Book`: the constructor stores the values, and `describe()` returns one line of text. Write `\"` inside a string to print a quote mark.
2. Create `models/EBook.java` with `package models;` and `public class EBook extends Book`. Add one new field, `private double sizeMb;`
3. In the `EBook` constructor, call `super(title, author, pages);` on the **first** line, then store `sizeMb`.
4. Override `describe()` in `EBook` with `@Override`. Reuse the parent version: `return super.describe() + " [ebook, " + sizeMb + " MB]";`
5. In `app/Main.java`: import both classes, put one `Book` and one `EBook` in a `Book[] library`, loop over it printing `describe()` and adding up `getPages()`. Then read a title with `Scanner` and print `Found it.` or `Not found.`

## Expected output

You type `Dune` when the program asks.

```
=== Library ===
"Kalila wa Dimna" by Ibn al-Muqaffa (192 pages)
"Clean Code" by Robert Martin (464 pages) [ebook, 3.2 MB]
Total pages: 656
Search title: Dune
Not found.
```

## Hint

An `EBook` **is a** `Book`, so it fits inside a `Book[]` array:

```java
Book[] library = {
    new Book("Kalila wa Dimna", "Ibn al-Muqaffa", 192),
    new EBook("Clean Code", "Robert Martin", 464, 3.2)
};
```

Java still runs the `EBook` version of `describe()` for the second one. That is the whole point
of overriding.

To compare text, use `equals`, never `==`: `if (library[i].getTitle().equals(wanted))`.

The folder name and the `package` line must match. A file in `models/` starts with
`package models;`.

## Stretch

Add a third class `AudioBook extends Book` with a `minutes` field and its own `describe()`.
Add it to the same array and change nothing else in the loop.
