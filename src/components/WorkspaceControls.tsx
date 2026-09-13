import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  Globe2,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { NetworkId } from "../domain/types";
import { number } from "./format";
import { AmountInput } from "./FinancialInput";
import { NETWORK_CHOICES, type NoriaWorkspace } from "./useNoriaWorkspace";
import s from "./NoriaApp.module.css";

export function WorkspaceControls({
  workspace,
}: {
  workspace: NoriaWorkspace;
}) {
  const {
    network,
    networks,
    networkLoading,
    networkError,
    networkLabel,
    selectedNetwork,
    retryNetworks,
    query,
    queryInput,
    capital,
    setCapital,
    intent,
    setIntent,
    horizon,
    setHorizon,
    discount,
    setDiscount,
    report,
    analyzing,
    selectedPool,
    discountNumber,
    discountValid,
    inputsValid,
    searching,
    changeNetwork,
    changeQuery,
    searchPools,
    analyze,
  } = workspace;
  return (
    <aside className={s.controls} aria-labelledby="configure-heading">
      <div className={s.controlHeading}>
        <span className={s.stepNumber}>01</span>
        <h2 id="configure-heading">Find your pool & range</h2>
      </div>
      <div className={s.networkField}>
        <label htmlFor="noria-network">Network</label>
        <div className={s.networkSelect}>
          <Globe2 size={16} />
          <select
            id="noria-network"
            value={network}
            onChange={(event) => changeNetwork(event.target.value as NetworkId)}
          >
            {NETWORK_CHOICES.map((choice) => {
              const state = networks.find((item) => item.id === choice.id);
              return (
                <option key={choice.id} value={choice.id}>
                  {state?.label ?? choice.label}
                  {state?.available === false ? " — unavailable" : ""}
                </option>
              );
            })}
          </select>
          <ChevronDown size={14} />
        </div>
        {networkLoading ? (
          <p className={s.networkStatus} role="status">
            <Loader2 className={s.spinner} size={11} />
            Loading supported networks…
          </p>
        ) : networkError ? (
          <div className={s.networkUnavailable} role="alert">
            <p>{networkError}</p>
            <button type="button" onClick={retryNetworks}>
              Retry availability
            </button>
          </div>
        ) : selectedNetwork?.available ? (
          <p className={s.networkStatus}>
            <Check size={11} />
            Discovery enabled on {networkLabel}
          </p>
        ) : (
          <div className={s.networkUnavailable} role="status">
            <strong>{networkLabel} is unavailable</strong>
            <p>
              {selectedNetwork?.reason ??
                "This network is not enabled for discovery."}
            </p>
          </div>
        )}
      </div>
      <div className={s.queryField}>
        <label htmlFor="noria-query">
          Pool preference <span>OPTIONAL</span>
        </label>
        <div className={s.queryInput}>
          <Search size={14} />
          <input
            ref={queryInput}
            id="noria-query"
            type="search"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={query}
            maxLength={80}
            placeholder="Symbol, pair, or pool address"
            disabled={analyzing}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void analyze();
              }
            }}
          />
        </div>
        <p>Leave blank to discover candidates on this network.</p>
      </div>
      <fieldset className={s.fieldset} disabled={analyzing}>
        <legend>
          Capital to model <span>USD</span>
        </legend>
        <div className={s.segmented}>
          {([1000, 5000, 10000] as const).map((amount) => (
            <button
              key={amount}
              type="button"
              aria-pressed={capital === amount}
              className={capital === amount ? s.selected : ""}
              onClick={() => setCapital(amount)}
            >
              ${number(amount, 0)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className={s.fieldset} disabled={analyzing}>
        <legend>What is your goal?</legend>
        <div className={s.intentOptions}>
          <button
            type="button"
            aria-pressed={intent === "earn-fees"}
            className={`${s.intentOption} ${intent === "earn-fees" ? s.selectedIntent : ""}`}
            onClick={() => setIntent("earn-fees")}
          >
            <span className={s.intentIcon}>
              <Layers size={18} />
            </span>
            <span>
              <strong>Earn fees</strong>
              <small>Model exposure to fee income</small>
            </span>
            <i>{intent === "earn-fees" && <Check size={11} />}</i>
          </button>
          <button
            type="button"
            aria-pressed={intent === "buy-token0"}
            className={`${s.intentOption} ${intent === "buy-token0" ? s.selectedIntent : ""}`}
            onClick={() => setIntent("buy-token0")}
          >
            <span className={s.intentIcon}>
              <ArrowDownRight size={19} />
            </span>
            <span>
              <strong>Planned conversion</strong>
              <small>
                {report
                  ? `Buy ${report.pool.token0} with ${report.pool.token1}`
                  : "Model a purchase below market"}
              </small>
            </span>
            <i>{intent === "buy-token0" && <Check size={11} />}</i>
          </button>
        </div>
      </fieldset>
      {intent === "buy-token0" && (
        <fieldset className={s.fieldset} disabled={analyzing}>
          <legend>
            <label htmlFor="noria-discount">Entry discount</label>
            <span>BASIS POINTS</span>
          </legend>
          <div className={s.discountInput}>
            <AmountInput
              id="noria-discount"
              decimals={0}
              value={discount}
              aria-invalid={!discountValid}
              aria-describedby="noria-discount-help"
              onValueChange={setDiscount}
            />
            <span>bps</span>
          </div>
          <input
            className={s.discountSlider}
            type="range"
            min="25"
            max="1000"
            step="25"
            aria-label="Entry discount in basis points"
            value={discountValid ? discountNumber : 25}
            onChange={(event) => setDiscount(event.target.value)}
          />
          <p
            className={discountValid ? s.fieldHelp : s.fieldError}
            id="noria-discount-help"
          >
            {discountValid
              ? `${number(discountNumber / 100, 2)}% below the source pool price`
              : "Enter a whole number from 25 to 1,000 bps."}
          </p>
        </fieldset>
      )}
      <fieldset className={s.fieldset} disabled={analyzing}>
        <legend>Review in</legend>
        <div className={s.segmented}>
          {([6, 24] as const).map((hours) => (
            <button
              key={hours}
              type="button"
              aria-pressed={horizon === hours}
              className={horizon === hours ? s.selected : ""}
              onClick={() => setHorizon(hours)}
            >
              <Clock size={13} />
              {hours} hours
            </button>
          ))}
        </div>
        <p className={s.fieldHelp}>
          When to reassess; does not change the range model.
        </p>
      </fieldset>
      <button
        type="button"
        className={s.analyzeButton}
        disabled={
          analyzing || !inputsValid || networkLoading || Boolean(networkError)
        }
        onClick={() => void analyze()}
      >
        {analyzing ? (
          <>
            <Loader2 className={s.spinner} size={17} />
            {selectedPool ? "Analyzing pool…" : "Finding pool & range…"}
          </>
        ) : (
          <>
            Find a pool & range
            <ArrowUpRight size={19} />
          </>
        )}
      </button>
      <p className={s.readOnly}>
        <ShieldCheck size={12} />
        Read-only analysis. No wallet required.
      </p>
      <details className={s.advancedSearch}>
        <summary>
          <span>Advanced: choose a pool yourself</span>
          <ChevronDown size={13} />
        </summary>
        <p>
          Use the network and optional query above to inspect indexed pools
          before choosing one.
        </p>
        <button
          type="button"
          className={s.outlineButton}
          disabled={
            !selectedNetwork?.available ||
            networkLoading ||
            Boolean(networkError) ||
            searching ||
            analyzing
          }
          onClick={() => void searchPools()}
        >
          {searching ? (
            <Loader2 className={s.spinner} size={13} />
          ) : (
            <Search size={13} />
          )}
          {searching ? "Searching pools…" : "Search pools"}
        </button>
      </details>
      <div className={s.controlFootnote}>
        <span>CONSTRUCTION ≠ PROFITABILITY</span>
        <p>
          A position that can be built still needs an economic case. Noria makes
          that distinction explicit.
        </p>
      </div>
    </aside>
  );
}
