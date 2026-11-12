"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  ConfigProvider,
  Descriptions,
  Divider,
  Drawer,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import type { ColumnsType, TableProps } from "antd/es/table";
import {
  CheckOutlined,
  ReloadOutlined,
  BankOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import {
  FINANCE_CATEGORIE_LABEL,
  FINANCE_STATUS_LABEL,
  type FinanceBetaling,
  type FinanceCategorie,
  type FinanceStatus,
} from "@/lib/finance-uitbetalingen-types";
import { formatEuro } from "@/lib/format";

type FilterStatus = "alle" | "te_goedkeuren" | "concept" | "betaald";

function statusColor(status: FinanceStatus): string {
  switch (status) {
    case "te_goedkeuren":
      return "orange";
    case "goedgekeurd":
    case "in_behandeling":
      return "blue";
    case "betaald":
      return "green";
    case "mislukt":
      return "red";
    case "geannuleerd":
      return "default";
    default:
      return "default";
  }
}

function categorieColor(c: FinanceCategorie): string {
  switch (c) {
    case "adviseur":
      return "cyan";
    case "installatie_partner":
      return "purple";
    case "edergy":
      return "geekblue";
    case "inkoop":
      return "gold";
    case "operations":
      return "magenta";
    default:
      return "default";
  }
}

function FinancePanelInner() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<FinanceBetaling[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("te_goedkeuren");
  const [filterCat, setFilterCat] = useState<FinanceCategorie | "alle">("alle");
  const [summary, setSummary] = useState({
    te_goedkeuren: 0,
    totaal_open_inc: 0,
    betaald: 0,
  });
  const [selected, setSelected] = useState<FinanceBetaling | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/finance/betalingen");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setRows((data.betalingen as FinanceBetaling[]) || []);
      setSummary(
        data.summary || { te_goedkeuren: 0, totaal_open_inc: 0, betaald: 0 }
      );
      setHint(data.hint || null);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterCat !== "alle" && r.categorie !== filterCat) return false;
      if (filterStatus === "alle") return true;
      if (filterStatus === "te_goedkeuren") {
        return r.status === "te_goedkeuren" || r.status === "goedgekeurd";
      }
      return r.status === filterStatus;
    });
  }, [rows, filterCat, filterStatus]);

  async function goedkeuren(row: FinanceBetaling) {
    const key = `${row.bron}:${row.bron_id}`;
    setBusyKey(key);
    try {
      const res = await fetch("/api/finance/betalingen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auto_betaal: true,
          betaling: {
            categorie: row.categorie,
            bron: row.bron,
            bron_id: row.bron_id,
            begunstigde: row.begunstigde,
            iban: row.iban,
            omschrijving: row.omschrijving,
            referentie: row.referentie,
            bedrag_ex_btw: row.bedrag_ex_btw,
            bedrag_inc_btw: row.bedrag_inc_btw,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Goedkeuren mislukt");
      message.success(
        data.message || "Goedgekeurd — betaling wordt afgeschreven"
      );
      setSelected(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Goedkeuren mislukt");
    } finally {
      setBusyKey(null);
    }
  }

  function openDetail(row: FinanceBetaling) {
    setSelected(row);
  }

  const canApproveSelected =
    selected &&
    (selected.status === "te_goedkeuren" || selected.status === "goedgekeurd");
  const selectedBusyKey = selected
    ? `${selected.bron}:${selected.bron_id}`
    : null;

  const columns: ColumnsType<FinanceBetaling> = [
    {
      title: "Categorie",
      dataIndex: "categorie",
      width: 140,
      render: (c: FinanceCategorie) => (
        <Tag color={categorieColor(c)}>{FINANCE_CATEGORIE_LABEL[c]}</Tag>
      ),
      filters: (
        Object.keys(FINANCE_CATEGORIE_LABEL) as FinanceCategorie[]
      ).map((c) => ({ text: FINANCE_CATEGORIE_LABEL[c], value: c })),
      onFilter: (value, record) => record.categorie === value,
    },
    {
      title: "Begunstigde",
      dataIndex: "begunstigde",
      ellipsis: true,
      render: (naam: string, row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openDetail(row);
          }}
          className="max-w-full text-left"
        >
          <div className="font-medium text-[#1a7a4c] hover:underline">
            {naam}
          </div>
          {row.iban ? (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {row.iban}
            </Typography.Text>
          ) : null}
        </button>
      ),
    },
    {
      title: "Omschrijving",
      dataIndex: "omschrijving",
      ellipsis: true,
      render: (t: string, row) => (
        <div>
          <div>{t || "—"}</div>
          {row.referentie ? (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {row.referentie}
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: "Bedrag",
      dataIndex: "bedrag_inc_btw",
      width: 120,
      align: "right",
      sorter: (a, b) => a.bedrag_inc_btw - b.bedrag_inc_btw,
      render: (v: number) => (
        <span className="tabular-nums font-medium">
          {v > 0 ? formatEuro(v) : "—"}
        </span>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 140,
      render: (s: FinanceStatus) => (
        <Tag color={statusColor(s)}>{FINANCE_STATUS_LABEL[s]}</Tag>
      ),
    },
    {
      title: "Actie",
      key: "actie",
      width: 200,
      align: "right",
      fixed: "right",
      render: (_, row) => {
        const canApprove =
          row.status === "te_goedkeuren" || row.status === "goedgekeurd";
        const key = `${row.bron}:${row.bron_id}`;
        return (
          <Space size="small" onClick={(e) => e.stopPropagation()}>
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => openDetail(row)}
            >
              Check
            </Button>
            {canApprove ? (
              <Popconfirm
                title="Goedkeuren en uitbetalen?"
                description="Concept: markeert als betaald en boekt af van de rekening (bunq-koppeling volgt)."
                okText="Goedkeuren + betalen"
                cancelText="Annuleren"
                onConfirm={() => void goedkeuren(row)}
              >
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  loading={busyKey === key}
                >
                  Goedkeuren
                </Button>
              </Popconfirm>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.betaald_op
                  ? `Betaald ${row.betaald_op.slice(0, 10)}`
                  : "—"}
              </Typography.Text>
            )}
          </Space>
        );
      },
    },
  ];

  const tableProps: TableProps<FinanceBetaling> = {
    rowKey: (r) => `${r.bron}:${r.bron_id}`,
    columns,
    dataSource: filtered,
    loading,
    size: "middle",
    pagination: { pageSize: 25, showSizeChanger: true },
    scroll: { x: 960 },
    onRow: (record) => ({
      onClick: () => openDetail(record),
      style: { cursor: "pointer" },
    }),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <BankOutlined className="mr-2" />
            Finance · uitgaande betalingen
          </Typography.Title>
          <Typography.Text type="secondary">
            Adviseurs · installatiepartners · Edergy · inkoop · operations —
            goedkeuren = concept auto-uitbetalen
          </Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void load()}
          loading={loading}
        >
          Vernieuwen
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded border border-line bg-white px-4 py-3">
          <Statistic
            title="Te goedkeuren"
            value={summary.te_goedkeuren}
            valueStyle={{ color: "#d46b08" }}
          />
        </div>
        <div className="rounded border border-line bg-white px-4 py-3">
          <Statistic
            title="Open bedrag (inc.)"
            value={summary.totaal_open_inc}
            precision={2}
            prefix="€"
            valueStyle={{ color: "#0958d9" }}
          />
        </div>
        <div className="rounded border border-line bg-white px-4 py-3">
          <Statistic
            title="Betaald (in lijst)"
            value={summary.betaald}
            valueStyle={{ color: "#389e0d" }}
          />
        </div>
      </div>

      {hint ? (
        <Typography.Text type="warning">{hint}</Typography.Text>
      ) : null}

      <Space wrap size="middle" className="w-full justify-between">
        <Segmented
          value={filterStatus}
          onChange={(v) => setFilterStatus(v as FilterStatus)}
          options={[
            { label: "Te goedkeuren", value: "te_goedkeuren" },
            { label: "Concept", value: "concept" },
            { label: "Betaald", value: "betaald" },
            { label: "Alles", value: "alle" },
          ]}
        />
        <Select
          value={filterCat}
          onChange={(v) => setFilterCat(v)}
          style={{ minWidth: 180 }}
          options={[
            { value: "alle", label: "Alle categorieën" },
            ...(
              Object.keys(FINANCE_CATEGORIE_LABEL) as FinanceCategorie[]
            ).map((c) => ({
              value: c,
              label: FINANCE_CATEGORIE_LABEL[c],
            })),
          ]}
        />
      </Space>

      <div className="overflow-hidden rounded border border-line bg-white">
        <Table {...tableProps} />
      </div>

      <Drawer
        title={selected ? `Check · ${selected.begunstigde}` : "Betaling"}
        open={!!selected}
        onClose={() => setSelected(null)}
        width={440}
        destroyOnClose
        footer={
          selected ? (
            <Space style={{ width: "100%", justifyContent: "flex-end" }}>
              <Button onClick={() => setSelected(null)}>Sluiten</Button>
              {canApproveSelected ? (
                <Popconfirm
                  title="Goedkeuren en uitbetalen?"
                  description="Concept: markeert als betaald en boekt af van de rekening."
                  okText="Goedkeuren + betalen"
                  cancelText="Annuleren"
                  onConfirm={() => selected && void goedkeuren(selected)}
                >
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={busyKey === selectedBusyKey}
                  >
                    Goedkeuren
                  </Button>
                </Popconfirm>
              ) : null}
            </Space>
          ) : null
        }
      >
        {selected ? (
          <div className="flex flex-col gap-4">
            <Space wrap>
              <Tag color={categorieColor(selected.categorie)}>
                {FINANCE_CATEGORIE_LABEL[selected.categorie]}
              </Tag>
              <Tag color={statusColor(selected.status)}>
                {FINANCE_STATUS_LABEL[selected.status]}
              </Tag>
            </Space>

            <div>
              <Typography.Text type="secondary">Bedrag</Typography.Text>
              <Typography.Title level={3} style={{ margin: "4px 0 0" }}>
                {selected.bedrag_inc_btw > 0
                  ? formatEuro(selected.bedrag_inc_btw)
                  : "—"}
              </Typography.Title>
              {selected.bedrag_ex_btw != null && selected.bedrag_ex_btw > 0 ? (
                <Typography.Text type="secondary">
                  ex. btw {formatEuro(selected.bedrag_ex_btw)}
                </Typography.Text>
              ) : null}
            </div>

            <Divider style={{ margin: 0 }} />

            <Descriptions column={1} size="small">
              <Descriptions.Item label="Begunstigde">
                {selected.begunstigde}
              </Descriptions.Item>
              <Descriptions.Item label="IBAN">
                {selected.iban || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Omschrijving">
                {selected.omschrijving || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Referentie">
                {selected.referentie || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Bron">
                {selected.bron}
              </Descriptions.Item>
              <Descriptions.Item label="Goedgekeurd">
                {selected.goedgekeurd_op
                  ? selected.goedgekeurd_op.slice(0, 16).replace("T", " ")
                  : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Betaald">
                {selected.betaald_op
                  ? selected.betaald_op.slice(0, 16).replace("T", " ")
                  : "—"}
              </Descriptions.Item>
              {selected.foutmelding ? (
                <Descriptions.Item label="Fout">
                  <Typography.Text type="danger">
                    {selected.foutmelding}
                  </Typography.Text>
                </Descriptions.Item>
              ) : null}
            </Descriptions>

            {selected.link ? (
              <Button href={selected.link} target="_self">
                Open bron in CRM
              </Button>
            ) : null}

            {canApproveSelected ? (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Check IBAN, bedrag en omschrijving. Goedkeuren boekt de betaling
                als betaald (concept auto-uitbetaling).
              </Typography.Paragraph>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/** Finance-tab met Ant Design (ConfigProvider scoped). */
export function FinancePanel() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1a7a4c",
          borderRadius: 4,
          fontFamily: "inherit",
        },
      }}
    >
      <App>
        <FinancePanelInner />
      </App>
    </ConfigProvider>
  );
}
