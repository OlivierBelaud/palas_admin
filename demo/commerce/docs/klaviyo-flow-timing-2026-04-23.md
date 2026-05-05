# Temporalité des flows d'abandon

*Généré le 2026-04-23. Source : Klaviyo `/api/flow-actions/{id}/` (champ `settings` des TIME_DELAY). Temps exprimés par rapport au moment du trigger (= moment où la personne a abandonné).*

## FR Checkout Abandonné (`YuzaSN` · live)

| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |
|---:|---|---|---|---|
| 1 | "Votre bijou Palas n'attend plus que vous 💗" | **1j** | — | live |
| 2 | "Vous avez oublié quelque chose 👀" | **1j** | immédiat | live |
| 3 | "Un doute ? Une question ? Je suis là pour vous ❤️" | **3j** | 2j | live |
| 4 | "Votre bijou Palas n'attend plus que vous 💗" | **4j** | 1j | manual |
| 5 | "Votre bijou Palas n'attend plus que vous 💗" | **4j** | immédiat | manual |

<details><summary>Structure complète du flow</summary>

| # | Action | Détail |
|---:|---|---|
| 1 | `TIME_DELAY` | status=live · delay=2h |
| 2 | `TIME_DELAY` | status=live · delay=22h |
| 3 | `SEND_EMAIL` | status=live · subject="Votre bijou Palas n'attend plus que vous 💗" |
| 4 | `SEND_EMAIL` | status=live · subject="Vous avez oublié quelque chose 👀" |
| 5 | `TIME_DELAY` | status=live · delay=2j |
| 6 | `SEND_EMAIL` | status=live · subject="Un doute ? Une question ? Je suis là pour vous ❤️" |
| 7 | `BOOLEAN_BRANCH` | status=live |
| 8 | `SEND_SMS` | status=live |
| 9 | `TIME_DELAY` | status=live · delay=1j |
| 10 | `AB_TEST` | status=live |
| 11 | `AB_TEST` | status=live |
| 12 | `AB_TEST` | status=live |
| 13 | `SEND_EMAIL` | status=manual · subject="Votre bijou Palas n'attend plus que vous 💗" |
| 14 | `SEND_EMAIL` | status=manual · subject="Votre bijou Palas n'attend plus que vous 💗" |
| 15 | `UPDATE_CUSTOMER` | status=live |
| 16 | `UPDATE_CUSTOMER` | status=live |

</details>

## FR Panier Abandonné (ancien, draft) (`SYA3es` · draft)

| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |
|---:|---|---|---|---|
| 1 | "Vous avez oublié quelque chose 👀" | **2h** | — | draft |
| 2 | "Votre bijou Palas n'attend plus que vous 💗" | **1j 2h** | 1j | draft |
| 3 | "Un doute ? Une question ? Je suis là pour vous ❤️" | **3j 2h** | 2j | draft |

<details><summary>Structure complète du flow</summary>

| # | Action | Détail |
|---:|---|---|
| 1 | `TIME_DELAY` | status=live · delay=2h |
| 2 | `SEND_EMAIL` | status=draft · subject="Vous avez oublié quelque chose 👀" |
| 3 | `TIME_DELAY` | status=live · delay=1j |
| 4 | `SEND_EMAIL` | status=draft · subject="Votre bijou Palas n'attend plus que vous 💗" |
| 5 | `TIME_DELAY` | status=live · delay=2j |
| 6 | `SEND_EMAIL` | status=draft · subject="Un doute ? Une question ? Je suis là pour vous ❤️" |
| 7 | `AB_TEST` | status=draft |
| 8 | `UPDATE_CUSTOMER` | status=draft |
| 9 | `UPDATE_CUSTOMER` | status=draft |
| 10 | `AB_TEST` | status=draft |

</details>

## FR Panier Abandonné (nouveau, live) (`W4ruD9` · live)

| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |
|---:|---|---|---|---|
| 1 | "Vous avez oublié quelque chose 👀" | **immédiat** | — | live |
| 2 | "Votre bijou Palas n'attend plus que vous 💗" | **1j 2h** | 1j 2h | live |
| 3 | "Un doute ? Une question ? Je suis là pour vous ❤️" | **3j 2h** | 2j | live |

<details><summary>Structure complète du flow</summary>

| # | Action | Détail |
|---:|---|---|
| 1 | `SEND_EMAIL` | status=live · subject="Vous avez oublié quelque chose 👀" |
| 2 | `TIME_DELAY` | status=live · delay=2h |
| 3 | `UPDATE_CUSTOMER` | status=live |
| 4 | `TIME_DELAY` | status=live · delay=1j |
| 5 | `SEND_EMAIL` | status=live · subject="Votre bijou Palas n'attend plus que vous 💗" |
| 6 | `TIME_DELAY` | status=live · delay=2j |
| 7 | `SEND_EMAIL` | status=live · subject="Un doute ? Une question ? Je suis là pour vous ❤️" |
| 8 | `UPDATE_CUSTOMER` | status=live |

</details>

## FR Panier Abandonné - Typeform (draft) (`Tj89Zg` · draft)

| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |
|---:|---|---|---|---|
| 1 | "{{ first_name|default:'' }}, vous avez une minute ?" | **immédiat** | — | draft |

<details><summary>Structure complète du flow</summary>

| # | Action | Détail |
|---:|---|---|
| 1 | `SEND_EMAIL` | status=draft · subject="{{ first_name|default:'' }}, vous avez une minute ?" |

</details>

## FR Winback 2 months (`RrYMuk` · live)

| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |
|---:|---|---|---|---|
| 1 | "-15% sur votre commande de bijoux ✨" | **immédiat** | — | live |
| 2 | "RE: votre commande Palas à -15%" | **3j** | 3j | live |

<details><summary>Structure complète du flow</summary>

| # | Action | Détail |
|---:|---|---|
| 1 | `SEND_EMAIL` | status=live · subject="-15% sur votre commande de bijoux ✨" |
| 2 | `TIME_DELAY` | status=live · delay=immédiat |
| 3 | `TIME_DELAY` | status=live · delay=3j |
| 4 | `SEND_EMAIL` | status=live · subject="RE: votre commande Palas à -15%" |

</details>

## FR Navigation Abandonnée (`WCcxfn` · live)

| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |
|---:|---|---|---|---|
| 1 | "Vous y pensez encore ?" | **1j** | — | live |

<details><summary>Structure complète du flow</summary>

| # | Action | Détail |
|---:|---|---|
| 1 | `TIME_DELAY` | status=live · delay=1j |
| 2 | `SEND_EMAIL` | status=live · subject="Vous y pensez encore ?" |
| 3 | `WEBHOOK` | status=live |
| 4 | `TIME_DELAY` | status=live · delay=2h |

</details>

## EN Panier Abandonné (`WL5Bc6` · live)

| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |
|---:|---|---|---|---|
| 1 | "Forgot something 👀" | **4h** | — | live |
| 2 | "Make it yours today 🌸" | **1j 4h** | 1j | live |
| 3 | "Got a question or not quite sure? I'm here to help ❤️" | **3j 4h** | 2j | live |

<details><summary>Structure complète du flow</summary>

| # | Action | Détail |
|---:|---|---|
| 1 | `TIME_DELAY` | status=live · delay=4h |
| 2 | `SEND_EMAIL` | status=live · subject="Forgot something 👀" |
| 3 | `TIME_DELAY` | status=live · delay=1j |
| 4 | `SEND_EMAIL` | status=live · subject="Make it yours today 🌸" |
| 5 | `TIME_DELAY` | status=live · delay=2j |
| 6 | `SEND_EMAIL` | status=live · subject="Got a question or not quite sure? I'm here to help ❤️" |

</details>

## EN Checkout Abandonné (`VGzPTF` · live)

| # email | Subject | Temps depuis le trigger | Délai depuis l'email précédent | Statut de l'action |
|---:|---|---|---|---|
| 1 | "We're almost out of the jewellery you love" | **2h** | — | live |
| 2 | "Your new jewellery is waiting for you" | **1j** | 22h | live |
| 3 | "Any doubts? Any questions? I'm here for you ❤️" | **3j** | 2j | live |

<details><summary>Structure complète du flow</summary>

| # | Action | Détail |
|---:|---|---|
| 1 | `TIME_DELAY` | status=live · delay=2h |
| 2 | `SEND_EMAIL` | status=live · subject="We're almost out of the jewellery you love" |
| 3 | `TIME_DELAY` | status=live · delay=22h |
| 4 | `SEND_EMAIL` | status=live · subject="Your new jewellery is waiting for you" |
| 5 | `TIME_DELAY` | status=live · delay=2j |
| 6 | `SEND_EMAIL` | status=live · subject="Any doubts? Any questions? I'm here for you ❤️" |
| 7 | `TIME_DELAY` | status=live · delay=1j |
| 8 | `BOOLEAN_BRANCH` | status=live |
| 9 | `SEND_SMS` | status=draft |

</details>
