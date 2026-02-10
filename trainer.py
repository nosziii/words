import csv
import random
from dataclasses import dataclass


CSV_FILE = "wordds.csv"


@dataclass
class Card:
    en: str
    hu: str


def load_cards(path: str) -> list[Card]:
    encodings = ["utf-8-sig", "cp1250", "latin-1"]
    last_error = None

    for enc in encodings:
        try:
            cards: list[Card] = []
            with open(path, "r", encoding=enc, newline="") as f:
                reader = csv.reader(f, delimiter=";")
                for row in reader:
                    if len(row) < 2:
                        continue
                    en = row[0].strip()
                    hu = row[1].strip()
                    if en and hu:
                        cards.append(Card(en=en, hu=hu))
            if cards:
                return cards
        except UnicodeDecodeError as e:
            last_error = e

    if last_error:
        raise last_error
    return []


def ask_direction() -> str:
    print("\nFordítás iránya:")
    print("1) angol -> magyar")
    print("2) magyar -> angol")
    while True:
        choice = input("Választás (1-2): ").strip()
        if choice in {"1", "2"}:
            return choice
        print("Hibás választás.")


def flashcards(cards: list[Card]) -> None:
    direction = ask_direction()
    shuffled = cards[:]
    random.shuffle(shuffled)
    print("\nSzókártyák (kilépés: q + Enter)")
    for i, card in enumerate(shuffled, start=1):
        front = card.en if direction == "1" else card.hu
        back = card.hu if direction == "1" else card.en
        print(f"\n[{i}/{len(shuffled)}] {front}")
        cmd = input("Enter = mutat, q = kilép: ").strip().lower()
        if cmd == "q":
            break
        print(f"-> {back}")


def typing_quiz(cards: list[Card]) -> None:
    direction = ask_direction()
    total = min(15, len(cards))
    picks = random.sample(cards, total)
    good = 0

    print(f"\nGépelős kvíz ({total} kérdés)")
    for i, card in enumerate(picks, start=1):
        question = card.en if direction == "1" else card.hu
        answer = card.hu if direction == "1" else card.en
        guess = input(f"[{i}/{total}] {question} -> ").strip()
        if guess.casefold() == answer.casefold():
            print("Helyes.")
            good += 1
        else:
            print(f"Nem jó. Helyes: {answer}")
    print(f"\nEredmény: {good}/{total}")


def multiple_choice(cards: list[Card]) -> None:
    direction = ask_direction()
    total = min(15, len(cards))
    picks = random.sample(cards, total)
    good = 0

    print(f"\nFeleletválasztós kvíz ({total} kérdés)")
    for i, card in enumerate(picks, start=1):
        question = card.en if direction == "1" else card.hu
        correct = card.hu if direction == "1" else card.en

        pool = [c.hu if direction == "1" else c.en for c in cards if c != card]
        wrong = random.sample(pool, k=min(3, len(pool)))
        options = wrong + [correct]
        random.shuffle(options)

        print(f"\n[{i}/{total}] {question}")
        for idx, opt in enumerate(options, start=1):
            print(f"{idx}) {opt}")

        while True:
            raw = input(f"Válasz (1-{len(options)}): ").strip()
            if raw.isdigit() and 1 <= int(raw) <= len(options):
                break
            print("Hibás választás.")

        chosen = options[int(raw) - 1]
        if chosen == correct:
            print("Helyes.")
            good += 1
        else:
            print(f"Nem jó. Helyes: {correct}")

    print(f"\nEredmény: {good}/{total}")


def matching(cards: list[Card]) -> None:
    if len(cards) < 4:
        print("A párosításhoz legalább 4 szó kell.")
        return

    total = min(8, len(cards))
    picks = random.sample(cards, total)
    left = [c.en for c in picks]
    right = [c.hu for c in picks]
    random.shuffle(right)
    mapping = {c.en: c.hu for c in picks}

    remaining_left = left[:]
    remaining_right = right[:]
    score = 0

    print("\nPárosítás: válassz egy bal oldali szót és a hozzá tartozó jobb oldalit.")
    while remaining_left:
        print("\nBal oldal:")
        for i, item in enumerate(remaining_left, start=1):
            print(f"{i}) {item}")
        print("Jobb oldal:")
        for j, item in enumerate(remaining_right, start=1):
            print(f"{j}) {item}")

        li = input(f"Bal index (1-{len(remaining_left)}): ").strip()
        ri = input(f"Jobb index (1-{len(remaining_right)}): ").strip()
        if not (li.isdigit() and ri.isdigit()):
            print("Számot adj meg.")
            continue

        li_num = int(li)
        ri_num = int(ri)
        if not (1 <= li_num <= len(remaining_left) and 1 <= ri_num <= len(remaining_right)):
            print("Tartományon kívüli szám.")
            continue

        chosen_left = remaining_left[li_num - 1]
        chosen_right = remaining_right[ri_num - 1]

        if mapping[chosen_left] == chosen_right:
            print("Jó páros.")
            score += 1
            del remaining_left[li_num - 1]
            del remaining_right[ri_num - 1]
        else:
            print("Nem jó páros.")

    print(f"\nKész. Pontszám: {score}/{total}")


def main() -> None:
    cards = load_cards(CSV_FILE)
    if not cards:
        print(f"Nem található használható adat a(z) {CSV_FILE} fájlban.")
        return

    while True:
        print("\n=== Szótanuló ===")
        print("1) Szókártyák")
        print("2) Gépelős fordítás")
        print("3) Feleletválasztós kvíz")
        print("4) Párosítás")
        print("0) Kilépés")
        choice = input("Menü: ").strip()

        if choice == "1":
            flashcards(cards)
        elif choice == "2":
            typing_quiz(cards)
        elif choice == "3":
            multiple_choice(cards)
        elif choice == "4":
            matching(cards)
        elif choice == "0":
            print("Kilépés.")
            break
        else:
            print("Hibás menüpont.")


if __name__ == "__main__":
    main()
