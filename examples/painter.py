#!/usr/bin/env python3
"""
Reference painter, Python edition (07-AGENT-KIT §3).

Same loop as painter.ts, and the same non-negotiables:
  * a budget cap is required and enforced before anything is signed;
  * requests are chunked (03-PROTOCOL §4 is all-or-nothing per request);
  * every error in 03-PROTOCOL §6 is handled explicitly, and commented.

Install:  pip install requests eth-account
Run:      CANVAS_WALLET_KEY=0x... python painter.py job.json --budget 5.00

The wallet key never leaves this process; it signs an EIP-3009 authorization for the
exact amount the server quoted, and the facilitator submits it.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import sys
import time
from dataclasses import dataclass, field

import requests
from eth_account import Account
from eth_account.messages import encode_typed_data

CANVAS_ID = "2026"
API_VERSION = 1
TILE_SIZE = 100
MAX_PIXELS_PER_REQUEST = 50
IMMUNITY_MS = 60_000


class BudgetExceeded(RuntimeError):
    """Raised instead of signing anything the budget cannot cover."""


class Frozen(RuntimeError):
    """The canvas is frozen. Terminal, forever."""


def b64url_json(value: dict) -> str:
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def chunk_by_tile(pixels: list[dict], max_per_request: int = MAX_PIXELS_PER_REQUEST) -> list[list[dict]]:
    """One request never straddles two tiles: an unrelated pixel losing its race must
    not take the whole request down with it."""
    tiles: dict[tuple[int, int], list[dict]] = {}
    for pixel in pixels:
        key = (pixel["x"] // TILE_SIZE, pixel["y"] // TILE_SIZE)
        tiles.setdefault(key, []).append(pixel)

    chunks: list[list[dict]] = []
    for group in tiles.values():
        for i in range(0, len(group), max_per_request):
            chunks.append(group[i : i + max_per_request])
    return chunks


@dataclass
class CanvasClient:
    base_url: str
    private_key: str
    max_total_units: int
    per_pixel_ceiling_units: int | None = None
    session: requests.Session = field(default_factory=requests.Session)
    spent_units: int = 0

    def __post_init__(self) -> None:
        if self.max_total_units <= 0:
            raise ValueError("max_total_units must be positive — painting without a cap is not supported")
        self.account = Account.from_key(self.private_key)

    @property
    def remaining_units(self) -> int:
        return max(0, self.max_total_units - self.spent_units)

    # ---------------------------------------------------------------- reads

    def get_region(self, x: int, y: int, w: int, h: int) -> bytes:
        res = self.session.get(f"{self.base_url}/api/region", params={"x": x, "y": y, "w": w, "h": h})
        res.raise_for_status()
        return res.content

    def quote(self, pixels: list[dict]) -> dict:
        res = self.session.post(f"{self.base_url}/api/quote", json={"pixels": pixels})
        res.raise_for_status()
        return res.json()

    def diff_job(self, job: dict) -> list[dict]:
        """Which pixels of the job do not match the canvas right now."""
        pixels = job["pixels"]
        xs = [p["x"] for p in pixels]
        ys = [p["y"] for p in pixels]
        x0, y0 = min(xs), min(ys)
        w, h = max(xs) - x0 + 1, max(ys) - y0 + 1

        grid = self.get_region(x0, y0, w, h)
        return [p for p in pixels if grid[(p["y"] - y0) * w + (p["x"] - x0)] != p["c"]]

    # ---------------------------------------------------------------- writes

    def _sign_authorization(self, requirements: dict) -> dict:
        chain_id = int(requirements["network"].split(":")[1])
        valid_before = int(time.time()) + int(requirements["maxTimeoutSeconds"])
        nonce = "0x" + secrets.token_hex(32)

        typed = {
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "TransferWithAuthorization": [
                    {"name": "from", "type": "address"},
                    {"name": "to", "type": "address"},
                    {"name": "value", "type": "uint256"},
                    {"name": "validAfter", "type": "uint256"},
                    {"name": "validBefore", "type": "uint256"},
                    {"name": "nonce", "type": "bytes32"},
                ],
            },
            "primaryType": "TransferWithAuthorization",
            # USDC's EIP-712 domain; version "2" on both Base deployments (01-CONSTANTS).
            "domain": {
                "name": "USDC",
                "version": "2",
                "chainId": chain_id,
                "verifyingContract": requirements["asset"],
            },
            "message": {
                "from": self.account.address,
                "to": requirements["payTo"],
                "value": int(requirements["amount"]),
                "validAfter": 0,
                "validBefore": valid_before,
                "nonce": bytes.fromhex(nonce[2:]),
            },
        }

        signed = self.account.sign_message(encode_typed_data(full_message=typed))
        return {
            "signature": signed.signature.hex()
            if signed.signature.hex().startswith("0x")
            else "0x" + signed.signature.hex(),
            "authorization": {
                "from": self.account.address,
                "to": requirements["payTo"],
                "value": str(requirements["amount"]),
                "validAfter": "0",
                "validBefore": str(valid_before),
                "nonce": nonce,
            },
        }

    def paint_chunk(self, pixels: list[dict], handle: str | None = None) -> tuple[list[dict], list[dict], int]:
        """Returns (painted, retry, wait_ms). Raises on budget or freeze."""
        body = {"canvas": CANVAS_ID, "version": API_VERSION, "pixels": pixels}
        if handle:
            body["handle"] = handle

        # 1. bare POST -> the 402 IS the quote (03-PROTOCOL §2)
        res = self.session.post(f"{self.base_url}/api/paint", json=body)
        if res.status_code == 410:
            raise Frozen("the canvas is frozen")
        if res.status_code != 402:
            raise RuntimeError(f"expected 402, got {res.status_code}: {res.text[:200]}")

        offer = res.json()
        requirements = offer["accepts"][0]
        total = int(requirements["amount"])
        quote_token = requirements["extra"]["quote"]

        # 2. the cap, checked BEFORE a signature exists
        if total > self.remaining_units:
            raise BudgetExceeded(f"quote is {total} units, budget has {self.remaining_units} left")

        if self.per_pixel_ceiling_units is not None:
            quoted = self.quote(pixels)
            too_dear = [p for p in quoted["pixels"] if p["price_units"] > self.per_pixel_ceiling_units]
            if too_dear:
                affordable = [
                    p for p in pixels if not any(t["x"] == p["x"] and t["y"] == p["y"] for t in too_dear)
                ]
                if not affordable:
                    return [], [], 0
                return self.paint_chunk(affordable, handle)

        # 3. sign and resubmit. The quote token rides in X-Canvas-Quote (04-API):
        #    an EIP-3009 signature has nowhere to carry it.
        payload = self._sign_authorization(requirements)
        extra = {k: v for k, v in requirements["extra"].items() if k != "quote"}
        headers = {
            "X-Canvas-Quote": quote_token,
            "PAYMENT-SIGNATURE": b64url_json(
                {
                    "x402Version": 2,
                    "accepted": {**requirements, "extra": extra},
                    "payload": payload,
                }
            ),
        }

        paid = self.session.post(f"{self.base_url}/api/paint", json=body, headers=headers)

        if paid.status_code == 200:
            receipt = paid.json()["receipt"]
            self.spent_units += receipt["total_units"]
            return pixels, [], 0

        return self._handle_failure(paid, pixels)

    def _handle_failure(self, res: requests.Response, pixels: list[dict]) -> tuple[list[dict], list[dict], int]:
        """One branch per row of the 03-PROTOCOL §6 table."""
        try:
            body = res.json()
        except ValueError:
            body = {}
        error = body.get("error")

        if error == "IMMUNE":
            # Wait exactly as long as the pixel says. immune_until is public so every
            # bot can time this identically — no advantage, by design.
            until = max((p.get("immune_until", 0) for p in body.get("pixels", [])), default=0)
            wait = max(0, until - int(time.time() * 1000)) + 250 if until else IMMUNITY_MS
            return [], pixels, wait
        if error == "CAS_STALE":
            return [], pixels, 0  # someone painted first; re-quote at the new price
        if error == "SETTLING":
            return [], pixels, body.get("retry_after_ms", 1000)
        if error in ("QUOTE_EXPIRED", "QUOTE_INVALID", "QUOTE_CONSUMED"):
            return [], pixels, 0
        if error == "SETTLEMENT_FAILED":
            # The write was reverted and nobody was charged: safe to retry.
            return [], pixels, 1000
        if error == "RATE_LIMITED":
            return [], pixels, body.get("retry_after_ms", 5000)
        if error == "FROZEN":
            raise Frozen("the canvas is frozen")

        print(f"  giving up on {len(pixels)} pixels: {error or res.status_code}", file=sys.stderr)
        return [], [], 0

    def paint(self, pixels: list[dict], handle: str | None = None, attempts: int = 3) -> int:
        painted_total = 0
        for chunk in chunk_by_tile(pixels):
            remaining = chunk
            for _ in range(attempts):
                if not remaining:
                    break
                painted, retry, wait_ms = self.paint_chunk(remaining, handle)
                painted_total += len(painted)
                remaining = retry
                if wait_ms:
                    time.sleep(wait_ms / 1000)
        return painted_total


def main() -> int:
    parser = argparse.ArgumentParser(description="paint a job.json onto CANVAS 2026")
    parser.add_argument("job", help="path to job.json")
    parser.add_argument("--budget", type=float, required=True, help="hard cap in dollars, e.g. 5.00")
    parser.add_argument("--per-pixel-max", type=float, default=None, help="skip pixels above this price")
    parser.add_argument("--handle", default=None)
    parser.add_argument("--base-url", default=os.environ.get("CANVAS_API_BASE", "https://canvas2026.example"))
    parser.add_argument("--passes", type=int, default=50)
    args = parser.parse_args()

    key = os.environ.get("CANVAS_WALLET_KEY")
    if not key:
        print("CANVAS_WALLET_KEY is not set", file=sys.stderr)
        return 1

    with open(args.job) as handle:
        job = json.load(handle)
    if job.get("canvas") != CANVAS_ID or job.get("version") != API_VERSION:
        print("job.json is not a v1 job for canvas 2026", file=sys.stderr)
        return 1

    client = CanvasClient(
        base_url=args.base_url,
        private_key=key,
        max_total_units=round(args.budget * 1_000_000),
        per_pixel_ceiling_units=round(args.per_pixel_max * 1_000_000) if args.per_pixel_max else None,
    )

    for pass_number in range(args.passes):
        try:
            repair = client.diff_job(job)
        except requests.HTTPError as err:
            print(f"read failed: {err}", file=sys.stderr)
            return 1

        if not repair:
            print(f"pass {pass_number + 1}: canvas matches the job")
            return 0

        print(f"pass {pass_number + 1}: {len(repair)} pixels differ, ${client.remaining_units / 1e6:.2f} budget left")
        try:
            painted = client.paint(repair, args.handle)
        except BudgetExceeded as err:
            print(f"budget exhausted: {err}")
            return 0
        except Frozen:
            print("the canvas is frozen. 2026 is over.")
            return 0

        print(f"  painted {painted}, spent ${client.spent_units / 1e6:.2f} so far")
        # Everything just painted is immune for a minute; so is everything an opponent
        # just painted. Racing faster than that only burns quota.
        time.sleep(IMMUNITY_MS / 1000)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
