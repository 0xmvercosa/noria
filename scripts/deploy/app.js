/* The only broadcaster is the user-selected Rabby provider, after a click and confirmation. */
const el = (id) => document.getElementById(id);
let session,
  provider,
  connected,
  busy = false,
  started = 0,
  activity = "";
const providers = [];
window.addEventListener("eip6963:announceProvider", (event) => {
  if (
    event.detail?.info?.rdns === "io.rabby" ||
    event.detail?.provider?.isRabby
  )
    providers.push(event.detail.provider);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const storageKey = (reviewId = session.state.pending?.reviewId) =>
  `noria-deploy-${session.state.owner}-${session.state.buildHash}-${reviewId}`;
function eth(wei) {
  if (wei === null || wei === undefined) return "ETH balance unavailable";
  const value = BigInt(wei),
    whole = value / 10n ** 18n,
    part = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  const amount = `${whole}${part ? "." + part : ""}`;
  const ref =
    session?.price?.status === "available" ? session.price.reference : null;
  const usd =
    value === 0n
      ? "0.00"
      : ref && Date.now() / 1000 - ref.timestamp <= 900
        ? (Number(amount) * Number(ref.usd)).toFixed(2)
        : null;
  return `${amount} ETH (${usd === null ? "USD unavailable" : "$" + usd})`;
}
function message(text) {
  el("message").textContent = text;
}
async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: body
      ? { "Content-Type": "application/json", "X-Noria-Session": session.token }
      : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "The local request failed.");
  return value;
}
function render() {
  if (!session) return;
  const s = session.state,
    p = s.pending;
  el("owner").textContent = s.owner;
  el("balance").textContent = `Deployer balance: ${eth(session.balanceWei)}`;
  el("wallet").textContent = connected
    ? `Rabby connected: ${connected}`
    : "Rabby is not connected.";
  el("connect").disabled = busy;
  el("adapter-step").querySelector("span").textContent = s.adapter
    ? "Verified"
    : p?.review.stage === "adapter"
      ? "Review / receipt required"
      : "Pending";
  el("factory-step").querySelector("span").textContent = s.factory
    ? "Verified"
    : p?.review.stage === "factory"
      ? "Review / receipt required"
      : "Pending";
  el("stage-title").textContent = s.factory
    ? "2. Deployment complete"
    : s.adapter
      ? "2. Deploy the position factory"
      : "2. Deploy the inventory adapter";
  el("stage-copy").textContent = s.adapter
    ? "The adapter was verified. The factory will use that exact adapter address and the official Arbitrum protocols."
    : "Verify protocol identities and estimate gas before opening Rabby.";
  el("prepare").hidden = !!p || !!s.factory;
  el("prepare").disabled = busy || !same(connected, s.owner);
  el("review").hidden = !p || p.signingStarted;
  el("recovery").hidden = !p?.signingStarted;
  if (p) {
    el("payload").textContent = JSON.stringify(p.review, null, 2);
    const values = {
      Contract: p.review.stage,
      Network: "Arbitrum One (42161)",
      Deployer: s.owner,
      "Expected address": p.review.expectedAddress,
      Nonce: p.review.nonce,
      "Estimated fee": eth(p.review.estimatedFeeWei),
      "Review expires": new Date(p.review.expiresAt).toLocaleTimeString(),
    };
    el("summary").replaceChildren();
    for (const [key, value] of Object.entries(values)) {
      const dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = key;
      dd.textContent = value;
      el("summary").append(dt, dd);
    }
    el("sign").disabled =
      busy || !same(connected, s.owner) || Date.now() >= p.review.expiresAt;
    el("cancel").disabled = busy;
    if (!el("hash").value)
      el("hash").value = p.hash || localStorage.getItem(storageKey()) || "";
  }
  el("verify").disabled =
    busy || !/^0x[0-9a-fA-F]{64}$/.test(el("hash").value.trim());
  el("reset").disabled = busy || !el("ack").checked;
  el("complete").hidden = !s.factory;
  el("env").textContent = s.factory
    ? `NORIA_AQUA_FACTORY_ADDRESS=${s.factory}`
    : "";
  el("report-path").textContent = `Local report: ${session.reportPath}`;
  el("receipts").replaceChildren();
  for (const op of s.operations.filter((v) => v.verifiedAt)) {
    const div = document.createElement("div"),
      a = document.createElement("a"),
      text = document.createElement("p");
    div.className = "receipt";
    a.href = `https://arbiscan.io/tx/${op.hash}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `${op.review.stage}: ${op.receipt.status === "success" ? op.review.expectedAddress : "Deployment reverted"}`;
    text.textContent = `Receipt ${op.receipt.status} at block ${op.receipt.blockNumber} · gas paid ${eth(BigInt(op.receipt.gasUsed) * BigInt(op.receipt.effectiveGasPrice))}`;
    div.append(a, text);
    el("receipts").append(div);
  }
}
async function refresh() {
  session = await api("state");
  render();
}
async function task(label, fn) {
  if (busy) return;
  busy = true;
  activity = label;
  started = Date.now();
  el("spinner").hidden = false;
  message(label);
  render();
  try {
    await fn();
  } catch (e) {
    message(
      e.message || "Action did not complete. Inspect the saved operation.",
    );
  } finally {
    busy = false;
    el("spinner").hidden = true;
    render();
  }
}
async function assertWallet() {
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!same(accounts[0], session.state.owner))
    throw new Error(
      "Select the required deployment wallet in Rabby before continuing.",
    );
  if ((await provider.request({ method: "eth_chainId" })) !== "0xa4b1")
    throw new Error("Select Arbitrum One in Rabby before continuing.");
}
el("connect").onclick = () =>
  task(
    "Connecting Rabby — approve the connection in your extension…",
    async () => {
      provider =
        providers[0] ||
        window.rabby ||
        (window.ethereum?.isRabby
          ? window.ethereum
          : window.ethereum?.providers?.find((p) => p.isRabby));
      if (!provider)
        throw new Error(
          "Rabby was not found. Open this local URL in Chrome or Brave with Rabby enabled, then refresh.",
        );
      const accounts = await provider.request({
        method: "eth_requestAccounts",
      });
      connected = accounts[0];
      if (!same(connected, session.state.owner))
        throw new Error(
          "Connected address differs from the deployer. Select the required wallet in Rabby.",
        );
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xa4b1" }],
      });
      provider.on?.("accountsChanged", (accounts) => {
        connected = accounts[0];
        render();
      });
      provider.on?.("chainChanged", () =>
        message(
          "Wallet network changed. It will be checked again before signing.",
        ),
      );
      await assertWallet();
      message(
        "Wallet connected. Prepare the deployment to review its estimated fee.",
      );
    },
  );
el("prepare").onclick = () =>
  task("Checking protocol contracts and simulating deployment…", async () => {
    await assertWallet();
    await api("prepare", {});
    await refresh();
    message(
      "Unsigned deployment ready. Inspect the details, then confirm in Rabby.",
    );
  });
el("sign").onclick = () =>
  task("Awaiting your confirmation in Rabby…", async () => {
    const displayed = structuredClone(session.state.pending);
    if (!displayed || displayed.signingStarted)
      throw new Error("No unsigned review is available.");
    await assertWallet();
    // Persistence must succeed before the wallet is invoked. No retries of this call.
    const recoveryKey = storageKey(displayed.reviewId);
    if (localStorage.getItem(recoveryKey))
      throw new Error(
        "A transaction hash is saved for this review. Reload and verify it before signing again.",
      );
    localStorage.setItem(`${recoveryKey}-storage-check`, "1");
    localStorage.removeItem(`${recoveryKey}-storage-check`);
    const { review, reviewId } = await api("begin", {
      reviewId: displayed.reviewId,
    });
    if (
      reviewId !== displayed.reviewId ||
      JSON.stringify(review) !== JSON.stringify(displayed.review)
    )
      throw new Error(
        "The returned deployment differs from the displayed review. Reload and inspect the saved operation; nothing was signed.",
      );
    session.state.pending.signingStarted = true;
    render();
    await assertWallet();
    let hash;
    try {
      hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: review.owner,
            data: review.data,
            value: review.value,
            chainId: "0xa4b1",
            nonce: `0x${review.nonce.toString(16)}`,
            gas: review.gas,
          },
        ],
      });
    } catch (e) {
      if (e.code === 4001) {
        await api("cancel", { reviewId, acknowledged: true });
        await refresh();
        throw new Error(
          "You rejected the Rabby request. No deployment was submitted by this attempt.",
        );
      }
      throw new Error(
        "Rabby did not return a definite outcome. Inspect Activity and recover the hash below before doing anything again.",
      );
    }
    el("hash").value = hash;
    localStorage.setItem(recoveryKey, hash);
    await api("submitted", { reviewId, hash });
    await refresh();
    message(
      "Transaction submitted. Wait for confirmation in Rabby, then choose Verify saved deployment.",
    );
  });
el("verify").onclick = () =>
  task(
    "Checking the exact receipt, deployed code and protocol configuration…",
    async () => {
      const result = await api("verify", {
        reviewId: session.state.pending?.reviewId,
        hash: el("hash").value.trim(),
      });
      localStorage.removeItem(storageKey());
      el("hash").value = "";
      await refresh();
      message(
        !result.verified
          ? "The deployment reverted and gas was spent. Its receipt is recorded. Inspect the cause before preparing again."
          : session.state.factory
            ? "Both contracts verified. Export the report and configure the application."
            : "Adapter verified. You can now prepare the factory deployment.",
      );
    },
  );
el("cancel").onclick = () =>
  task("Cancelling unsigned review…", async () => {
    await api("cancel", { reviewId: session.state.pending?.reviewId });
    await refresh();
    message("Unsigned review cancelled. Prepare again for a fresh estimate.");
  });
el("reset").onclick = () =>
  task("Recording your inspection…", async () => {
    await api("cancel", {
      reviewId: session.state.pending?.reviewId,
      acknowledged: el("ack").checked,
    });
    localStorage.removeItem(storageKey());
    el("hash").value = "";
    el("ack").checked = false;
    await refresh();
    message(
      "Your acknowledgment was recorded. No successful receipt was inferred.",
    );
  });
el("ack").onchange = render;
el("hash").oninput = render;
setInterval(() => {
  if (busy)
    message(
      `${activity} ${Math.floor((Date.now() - started) / 1000)}s elapsed`,
    );
  else render();
}, 1000);
void task("Reading the local deployment state…", async () => {
  await refresh();
  message(
    session.state.pending
      ? "A saved operation needs your review. Do not repeat a pending deployment."
      : "Connect Rabby to begin. No wallet action occurs automatically.",
  );
});
