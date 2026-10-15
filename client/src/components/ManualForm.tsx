import { useState, type FormEvent } from "react";
import type { EventType, Payload } from "../types";
import { futureDate } from "../demo";
import { Notice } from "./ui";
export function ManualForm({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (payload: Payload) => void;
}) {
  const [type, setType] = useState<EventType>("reservation.created");
  const [eventId, setEventId] = useState(`evt-${crypto.randomUUID()}`),
    [source, setSource] = useState(""),
    [reservationId, setReservationId] = useState(""),
    [propertyId, setPropertyId] = useState("");
  const [version, setVersion] = useState("1"),
    [occurredAt, setOccurredAt] = useState(new Date().toISOString());
  const [checkIn, setCheckIn] = useState(futureDate(30)),
    [checkOut, setCheckOut] = useState(futureDate(35)),
    [error, setError] = useState("");
  const cancelled = type === "reservation.cancelled";
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (
      ![
        eventId,
        source,
        reservationId,
        ...(cancelled ? [] : [propertyId]),
      ].every((value) => value.trim().length > 0 && value.trim().length <= 200)
    ) {
      setError("Identificadores devem ter entre 1 e 200 caracteres.");
      return;
    }
    if (
      !Number.isInteger(Number(version)) ||
      Number(version) < 0 ||
      Number(version) > 2147483647
    ) {
      setError("Versão deve ser um inteiro entre 0 e 2147483647.");
      return;
    }
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(
        occurredAt,
      ) ||
      !Number.isFinite(Date.parse(occurredAt))
    ) {
      setError(
        "Informe occurredAt em ISO 8601 com fuso, por exemplo 2026-11-01T14:00:00Z.",
      );
      return;
    }
    if (!cancelled && checkOut <= checkIn) {
      setError("Checkout deve ser posterior ao check-in.");
      return;
    }
    const base = {
      eventId: eventId.trim(),
      source: source.trim(),
      sourceVersion: Number(version),
      occurredAt,
    };
    send(
      cancelled
        ? {
            ...base,
            type,
            reservation: {
              reservationId: reservationId.trim(),
              ...(propertyId.trim() ? { propertyId: propertyId.trim() } : {}),
              status: "cancelled",
            },
          }
        : {
            ...base,
            type,
            reservation: {
              reservationId: reservationId.trim(),
              propertyId: propertyId.trim(),
              checkIn,
              checkOut,
              status: "confirmed",
            },
          },
    );
  }
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">ENTRADA MANUAL</span>
          <h2>Enviar um evento</h2>
        </div>
        <span className="tag">POST /webhooks/reservations</span>
      </div>
      <p>
        Atualizações enviam o snapshot completo. A validação definitiva é feita
        pelo backend. HTTP 201 confirma apenas o recebimento.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={disabled} className="form-grid">
          <label>
            Tipo
            <select
              value={type}
              onChange={(e) => setType(e.target.value as EventType)}
            >
              <option>reservation.created</option>
              <option>reservation.updated</option>
              <option>reservation.cancelled</option>
            </select>
          </label>
          <label>
            Origem / canal
            <input
              required
              maxLength={200}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="airbnb-demo"
            />
          </label>
          <label className="wide">
            eventId
            <div className="input-action">
              <input
                required
                maxLength={200}
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  setEventId(`evt-${crypto.randomUUID()}`);
                  setOccurredAt(new Date().toISOString());
                }}
              >
                Novo ID
              </button>
            </div>
          </label>
          <label>
            reservationId
            <input
              required
              maxLength={200}
              value={reservationId}
              onChange={(e) => setReservationId(e.target.value)}
              placeholder="res-101"
            />
          </label>
          <label>
            propertyId {cancelled && "(opcional)"}
            <input
              required={!cancelled}
              maxLength={200}
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="prop-17"
            />
          </label>
          <label>
            sourceVersion
            <input
              required
              type="number"
              min="0"
              max="2147483647"
              step="1"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
          <label>
            occurredAt · ISO com fuso
            <input
              required
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </label>
          {!cancelled && (
            <>
              <label>
                Check-in
                <input
                  required
                  type="date"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              </label>
              <label>
                Checkout
                <input
                  required
                  type="date"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </label>
            </>
          )}
          <div className="wide form-footer">
            <small>
              Estado enviado: {cancelled ? "cancelled" : "confirmed"}. Reenvio
              preserva ID e horário até você editá-los.
            </small>
            <button className="primary">Enviar e acompanhar ↗</button>
          </div>
        </fieldset>
      </form>
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
