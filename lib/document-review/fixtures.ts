import type { Fixture } from "./model";
// Generated synthetic fixtures only. No real client contracts.
export const fixtures: Fixture[] = [
  {
    "id": "prestacao",
    "name": "Prestação de serviços fictícia",
    "format": "DOCX",
    "file": "/review-pilot/prestacao.docx",
    "fileSha256": "9c8526aec55edf30c4f3dc3f4d1b8ecdb3ad1d65c40f4751fb8f6ba41f171ec9",
    "clauses": [
      {
        "id": "titulo",
        "text": "CONTRATO FICTÍCIO — Prestação de serviços"
      },
      {
        "id": "clausula-1",
        "text": "Cláusula 1. A contratada entregará relatório mensal até o dia 10."
      },
      {
        "id": "clausula-2",
        "text": "Cláusula 2. A contratante poderá rescindir sem aviso e sem pagar os serviços concluídos."
      }
    ],
    "replacement": "Cláusula 2. A rescisão exige aviso de 30 dias e pagamento dos serviços efetivamente concluídos."
  },
  {
    "id": "locacao",
    "name": "Locação fictícia",
    "format": "PDF",
    "file": "/review-pilot/locacao.pdf",
    "fileSha256": "3c736adfa3b83b4ec856e15c6370b3c52141680cc3a6f4599f01f64ff7953382",
    "clauses": [
      {
        "id": "titulo",
        "text": "CONTRATO FICTÍCIO — Locação"
      },
      {
        "id": "clausula-1",
        "text": "Cláusula 1. O aluguel será pago até o dia 5 de cada mês."
      },
      {
        "id": "clausula-2",
        "text": "Cláusula 2. Qualquer atraso autoriza multa de 50% do aluguel."
      }
    ],
    "replacement": "Cláusula 2. A multa por atraso será objeto de negociação expressa entre as partes, antes da assinatura."
  },
  {
    "id": "confidencialidade",
    "name": "Confidencialidade fictícia",
    "format": "DOCX",
    "file": "/review-pilot/confidencialidade.docx",
    "fileSha256": "ea945f8612eceb9a90b48b5521f78037085127b669e581ab92fa3e0b891eff42",
    "clauses": [
      {
        "id": "titulo",
        "text": "CONTRATO FICTÍCIO — Confidencialidade"
      },
      {
        "id": "clausula-1",
        "text": "Cláusula 1. A parte receptora manterá sigilo das informações identificadas como confidenciais."
      },
      {
        "id": "clausula-2",
        "text": "Cláusula 2. O sigilo alcança informações públicas por prazo indeterminado."
      }
    ],
    "replacement": "Cláusula 2. Informações comprovadamente públicas não estão sujeitas ao sigilo contratual."
  }
];
