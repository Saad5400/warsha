# Python 04 — A class and your own module

**Goal:** Put your classes in a separate file inside a folder, and import them into `main.py`.
One class extends the other and replaces one of its methods.

## Starter code

You need two files in two places:

```
main.py
library/books.py
```

File: `library/books.py` (fill in the rest)

```python
class Book:
    def __init__(self, title, author, pages):
        # Store the three values on self.
        pass

    def describe(self):
        # Return: "Kalila wa Dimna" by Ibn al-Muqaffa (192 pages)
        return ""
```

## Tasks

1. Finish `Book`: `__init__` stores `self.title`, `self.author`, `self.pages`, and `describe()` returns one line of text.
2. Add `class EBook(Book):` in the same file. Its `__init__` takes one extra argument, `size_mb`, calls `super().__init__(title, author, pages)` first, then stores `self.size_mb`.
3. Give `EBook` its own `describe()` that reuses the parent one: `return f"{super().describe()} [ebook, {self.size_mb} MB]"`
4. Add a plain function `def total_pages(books):` at the bottom of `books.py`. It loops over the list and returns the sum of the pages.
5. In `main.py`: `from library.books import Book, EBook, total_pages`, build a list with one of each, loop printing `describe()`, print the total pages, then read a title with `input()` and print `Found it.` or `Not found.`

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

The import path follows the folders: the file `library/books.py` is imported as `library.books`.
You do not need any extra file in the `library` folder.

To put a quote mark inside an f-string, wrap the whole string in single quotes:

```python
return f'"{self.title}" by {self.author} ({self.pages} pages)'
```

The loop in `main.py` does not care which class each object is. Python calls the `describe()` that
belongs to each object. That is why the ebook line is longer than the other one.

## Stretch

Add `class AudioBook(Book):` with a `minutes` field and its own `describe()`. Add it to the same
list and change nothing else in the loop. Then set `pages = 0` for it and check that
`total_pages` still works.
