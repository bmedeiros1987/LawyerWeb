import { createHash } from "node:crypto";

const DATAJUD_BASE_URL = "https://api-publica.datajud.cnj.jus.br";
// Public key published by CNJ. It is not a secret and may rotate.
const DATAJUD_PUBLIC_API_KEY = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

const STATE_COURT_BY_CODE: Record<string, string> = {
  "01": "ac", "02": "al", "03": "ap", "04": "am", "05": "ba", "06": "ce", "07": "df",
  "08": "es", "09": "go", "10": "ma", "11": "mt", "12": "ms", "13": "mg", "14": "pa",
  "15": "pb", "16": "pr", "17": "pe", "18": "pi", "19": "rj", "20": "rn", "21": "rs",
  "22": "ro", "23": "rr", "24": "sc", "25": "se", "26": "sp", "27": "to",
};

const STATE_CODES = new Set(Object.values(STATE_COURT_BY_CODE));

export type DataJudComplement = {
  codigo?: string | number | null;
  descricao?: string | null;
  valor?: string | number | boolean | null;
  nome?: string | null;
};

export type DataJudMovement = {
  codigo?: string | number | null;
  nome?: string | null;
  dataHora?: string | null;
  complementosTabelados?: DataJudComplement[] | null;
  orgaoJulgador?: {
    codigoOrgao?: string | number | null;
    nomeOrgao?: string | null;
  } | null;
};

export type DataJudProcess = {
  id: string;
  tribunal?: string | null;
  numeroProcesso?: string | null;
  dataHoraUltimaAtualizacao?: string | number | null;
  movimentos: DataJudMovement[];
};

type SearchResponse = {
  hits?: {
    hits?: Array<{
      _id?: string;
      _source?: {
        id?: string;
        tribunal?: string | null;
        numeroProcesso?: string | null;
        dataHoraUltimaAtualizacao?: string | number | null;
        movimentos?: DataJudMovement[] | null;
      };
    }>;
  };
};

function compactCourtLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function validNumber(value: number, max: number) {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

export function normalizeProcessNumber(value: string) {
  return value.replace(/\D/g, "");
}

export function dataJudAliasFromCourt(court?: string | null) {
  if (!court) return null;
  const label = compactCourtLabel(court);

  for (const superior of ["STJ", "TST", "TSE", "STM"] as const) {
    if (label.includes(superior)) return superior.toLowerCase();
  }

  const military = label.match(/TJM(MG|RS|SP)/);
  if (military) return `tjm${military[1].toLowerCase()}`;

  const trf = label.match(/TRF0?([1-6])/);
  if (trf) return `trf${Number(trf[1])}`;

  const trt = label.match(/TRT0?(2[0-4]|1[0-9]|[1-9])/);
  if (trt) return `trt${Number(trt[1])}`;

  const tre = label.match(/TRE(?:DFT|DF|([A-Z]{2}))/);
  if (tre) {
    if (tre[0].includes("DF")) return "tre-dft";
    const state = tre[1]?.toLowerCase();
    if (state && STATE_CODES.has(state)) return `tre-${state}`;
  }

  if (label.includes("TJDFT") || label.includes("TJDF")) return "tjdft";
  const tj = label.match(/TJ([A-Z]{2})/);
  const state = tj?.[1]?.toLowerCase();
  if (state && STATE_CODES.has(state)) return `tj${state}`;

  return null;
}

export function dataJudAliasFromProcessNumber(value: string) {
  const digits = normalizeProcessNumber(value);
  if (digits.length !== 20) return null;
  const justice = digits[13];
  const tribunalCode = digits.slice(14, 16);
  const tribunalNumber = Number(tribunalCode);

  if (justice === "4" && validNumber(tribunalNumber, 6)) return `trf${tribunalNumber}`;
  if (justice === "5" && validNumber(tribunalNumber, 24)) return `trt${tribunalNumber}`;

  if (justice === "6") {
    const state = STATE_COURT_BY_CODE[tribunalCode];
    if (!state) return null;
    return state === "df" ? "tre-dft" : `tre-${state}`;
  }

  if (justice === "8") {
    const state = STATE_COURT_BY_CODE[tribunalCode];
    if (!state) return null;
    return state === "df" ? "tjdft" : `tj${state}`;
  }

  if (justice === "9") {
    if (tribunalCode === "13") return "tjmmg";
    if (tribunalCode === "21") return "tjmrs";
    if (tribunalCode === "26") return "tjmsp";
  }

  return null;
}

export function dataJudAliasForMatter(number: string, court?: string | null) {
  return dataJudAliasFromCourt(court) ?? dataJudAliasFromProcessNumber(number);
}

export function dataJudMovementIdentity(processId: string, movement: DataJudMovement) {
  const canonical = JSON.stringify({
    processId,
    codigo: movement.codigo ?? null,
    dataHora: movement.dataHora ?? null,
    nome: movement.nome ?? null,
    orgao: movement.orgaoJulgador?.codigoOrgao ?? movement.orgaoJulgador?.nomeOrgao ?? null,
    complementos: movement.complementosTabelados ?? null,
  });
  const contentHash = createHash("sha256").update(canonical).digest("hex");
  return {
    externalId: `datajud:${processId}:${contentHash.slice(0, 32)}`,
    contentHash,
  };
}

export function orderedDataJudMovements(movements: DataJudMovement[]) {
  return movements
    .filter(movement => Boolean(movement.dataHora || movement.nome || movement.codigo))
    .slice()
    .sort((a, b) => {
      const aTime = a.dataHora ? Date.parse(a.dataHora) : 0;
      const bTime = b.dataHora ? Date.parse(b.dataHora) : 0;
      return aTime - bTime;
    });
}

export function dataJudMovementBody(movement: DataJudMovement) {
  const parts = [
    movement.nome?.trim() || (movement.codigo != null ? `Movimentação TPU ${movement.codigo}` : "Movimentação processual"),
    movement.dataHora ? `Ocorrência informada pelo DataJud: ${movement.dataHora}` : null,
    movement.orgaoJulgador?.nomeOrgao ? `Órgão julgador: ${movement.orgaoJulgador.nomeOrgao}` : null,
    "Fonte: Conselho Nacional de Justiça (CNJ) / DataJud.",
    "Informação sujeita à atualização pelo tribunal de origem e à revisão humana no MBLZ.",
  ].filter(Boolean);
  return parts.join("\n");
}

export async function fetchDataJudProcess(number: string, court?: string | null): Promise<{ alias: string; process: DataJudProcess | null }> {
  const normalized = normalizeProcessNumber(number);
  if (normalized.length !== 20) throw new Error("Número CNJ inválido para consulta DataJud.");

  const alias = dataJudAliasForMatter(normalized, court);
  if (!alias) throw new Error("Tribunal ainda não reconhecido pelo conector DataJud.");

  const response = await fetch(`${DATAJUD_BASE_URL}/api_publica_${alias}/_search`, {
    method: "POST",
    headers: {
      Authorization: `APIKey ${process.env.DATAJUD_PUBLIC_API_KEY?.trim() || DATAJUD_PUBLIC_API_KEY}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      size: 1,
      query: { match: { numeroProcesso: normalized } },
      _source: ["id", "tribunal", "numeroProcesso", "dataHoraUltimaAtualizacao", "movimentos"],
    }),
  });

  if (!response.ok) throw new Error(`DataJud indisponível (${response.status}).`);
  const payload = await response.json() as SearchResponse;
  const hit = payload.hits?.hits?.[0];
  if (!hit?._source) return { alias, process: null };

  const source = hit._source;
  return {
    alias,
    process: {
      id: source.id || hit._id || `${alias}:${normalized}`,
      tribunal: source.tribunal ?? null,
      numeroProcesso: source.numeroProcesso ?? normalized,
      dataHoraUltimaAtualizacao: source.dataHoraUltimaAtualizacao ?? null,
      movimentos: Array.isArray(source.movimentos) ? source.movimentos : [],
    },
  };
}
