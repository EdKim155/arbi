import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface ApiUser {
  id: string;
  email: string;
  telegramUserId?: string | null;
  notificationsEnabled: boolean;
  createdAt: string;
}

interface ApiMonitor {
  id: string;
  contractAddress: string;
  mexcSymbol?: string;
  jupiterMintAddress?: string;
  displayName?: string;
  conditions: Array<{ id: string; type: string; threshold: number; isActive: boolean }>;
  createdAt: string;
}

interface PricePoint {
  contractAddress: string;
  mexcPrice: number | null;
  jupiterPrice: number | null;
  spread: number | null;
  updatedAt: string;
}

interface PriceMessage {
  type: 'price';
  monitorId: string;
  price: PricePoint;
}

interface AlertMessage {
  type: 'alert';
  monitorId: string;
  conditionId: string;
  price: PricePoint;
}

type SocketMessage = PriceMessage | AlertMessage | { type: 'ready' } | { type: 'error'; message: string };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL ?? API_BASE_URL.replace('http', 'ws');

interface HistoryEntry {
  timestamp: number;
  mexc: number | null;
  jupiter: number | null;
}

const useWebSocket = (token: string | null, onMessage: (message: SocketMessage) => void) => {
  useEffect(() => {
    if (!token) {
      return;
    }
    const ws = new WebSocket(`${WS_BASE_URL.replace(/\/$/, '')}/ws?token=${token}`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        onMessage(data as SocketMessage);
      } catch (err) {
        console.error('Failed to parse ws message', err);
      }
    };
    ws.onopen = () => {
      console.log('ws connected');
    };
    ws.onerror = (event) => {
      console.error('ws error', event);
    };
    return () => ws.close();
  }, [token, onMessage]);
};

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<ApiMonitor[]>([]);
  const [loadingMonitors, setLoadingMonitors] = useState(false);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [latestPrices, setLatestPrices] = useState<Record<string, PricePoint>>({});
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});
  const [alerts, setAlerts] = useState<string[]>([]);

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [formState, setFormState] = useState({ email: '', password: '', telegramUserId: '' });

  const [monitorForm, setMonitorForm] = useState({
    contractAddress: '',
    mexcSymbol: '',
    jupiterMintAddress: '',
    displayName: '',
    spreadThreshold: '1.0',
  });

  const handleSocketMessage = useCallback((message: SocketMessage) => {
    if (message.type === 'price') {
      setLatestPrices((prev) => ({ ...prev, [message.monitorId]: message.price }));
      setHistory((prev) => {
        const prevHistory = prev[message.monitorId] ?? [];
        const nextHistory = [
          ...prevHistory,
          {
            timestamp: new Date(message.price.updatedAt).getTime(),
            mexc: message.price.mexcPrice,
            jupiter: message.price.jupiterPrice,
          },
        ].slice(-120);
        return { ...prev, [message.monitorId]: nextHistory };
      });
    }
    if (message.type === 'alert') {
      setAlerts((prev) => [
        `${new Date().toLocaleTimeString()} ▸ Сработало условие для ${message.monitorId} (спред ${(message.price.spread ?? 0).toFixed(2)}%)`,
        ...prev,
      ].slice(0, 5));
    }
  }, []);

  useWebSocket(token, handleSocketMessage);

  const authenticatedFetch = async <T,>(input: RequestInfo, init?: RequestInit): Promise<T> => {
    if (!token) {
      throw new Error('Нет токена');
    }
    const response = await fetch(input, {
      ...(init ?? {}),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Ошибка запроса');
    }
    return response.json();
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/${authMode === 'login' ? 'auth/login' : 'auth/register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formState.email,
          password: formState.password,
          telegramUserId: formState.telegramUserId || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message ?? 'Ошибка авторизации');
      }
      setToken(body.token);
      setUser(body.user);
      await loadMonitors(body.token);
    } catch (err: any) {
      setAuthError(err.message ?? 'Неизвестная ошибка');
    }
  };

  const loadMonitors = async (authToken = token) => {
    if (!authToken) return;
    setLoadingMonitors(true);
    try {
      const response = await fetch(`${API_BASE_URL}/monitoring/contracts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message ?? 'Не удалось загрузить контракты');
      }
      setMonitors(body.monitors);
      if (body.monitors.length > 0 && !selectedMonitorId) {
        setSelectedMonitorId(body.monitors[0].id);
      }
    } catch (err: any) {
      setAuthError(err.message ?? 'Не удалось загрузить контракты');
    } finally {
      setLoadingMonitors(false);
    }
  };

  const handleCreateMonitor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const payload = {
        contractAddress: monitorForm.contractAddress,
        mexcSymbol: monitorForm.mexcSymbol || undefined,
        jupiterMintAddress: monitorForm.jupiterMintAddress || undefined,
        displayName: monitorForm.displayName || undefined,
        conditions: [
          {
            type: 'spread_greater_than',
            threshold: Number(monitorForm.spreadThreshold),
            isActive: true,
          },
        ],
      };
      const response = await authenticatedFetch<{ monitor: ApiMonitor }>(`${API_BASE_URL}/monitoring/contracts`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMonitors((prev) => [...prev, response.monitor]);
      setMonitorForm({ contractAddress: '', mexcSymbol: '', jupiterMintAddress: '', displayName: '', spreadThreshold: '1.0' });
      if (!selectedMonitorId) {
        setSelectedMonitorId(response.monitor.id);
      }
    } catch (err: any) {
      alert(err.message ?? 'Не удалось создать контракт');
    }
  };

  const toggleNotifications = async () => {
    if (!user) return;
    try {
      const response = await authenticatedFetch<ApiUser>(`${API_BASE_URL}/auth/notifications`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !user.notificationsEnabled }),
      });
      setUser(response);
    } catch (err: any) {
      alert(err.message ?? 'Не удалось обновить настройки');
    }
  };

  useEffect(() => {
    if (token) {
      loadMonitors(token);
    }
  }, [token]);

  const selectedMonitor = useMemo(
    () => monitors.find((monitor) => monitor.id === selectedMonitorId) ?? null,
    [monitors, selectedMonitorId],
  );

  const chartData = selectedMonitor ? history[selectedMonitor.id] ?? [] : [];

  const copyToClipboard = async (text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    } catch (err) {
      console.error('copy failed', err);
    }
  };

  return (
    <main style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2.5rem' }}>Arbi Monitor</h1>
          <p style={{ marginTop: '0.5rem', color: '#94a3b8' }}>
            Мониторинг спреда между MEXC Futures и Jupiter в реальном времени
          </p>
        </div>
        {user && (
          <div style={{ textAlign: 'right' }}>
            <div>{user.email}</div>
            <button
              onClick={toggleNotifications}
              style={{
                marginTop: '0.5rem',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: user.notificationsEnabled ? '#22c55e' : '#64748b',
                color: '#0f172a',
                fontWeight: 600,
              }}
            >
              {user.notificationsEnabled ? 'Уведомления включены' : 'Уведомления выключены'}
            </button>
          </div>
        )}
      </header>

      {!user ? (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          <form
            onSubmit={handleAuth}
            style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '1rem',
              padding: '1.5rem',
            }}
          >
            <h2 style={{ marginTop: 0 }}>{authMode === 'login' ? 'Вход' : 'Регистрация'}</h2>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Email
              <input
                type="email"
                required
                value={formState.email}
                onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                style={{ width: '100%', marginTop: '0.25rem', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid rgba(148, 163, 184, 0.3)' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Пароль
              <input
                type="password"
                required
                minLength={8}
                value={formState.password}
                onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                style={{ width: '100%', marginTop: '0.25rem', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid rgba(148, 163, 184, 0.3)' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Telegram ID (опционально)
              <input
                type="text"
                value={formState.telegramUserId}
                onChange={(event) => setFormState((prev) => ({ ...prev, telegramUserId: event.target.value }))}
                style={{ width: '100%', marginTop: '0.25rem', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid rgba(148, 163, 184, 0.3)' }}
              />
            </label>
            {authError && <p style={{ color: '#f87171' }}>{authError}</p>}
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: 'linear-gradient(135deg, #2563eb, #38bdf8)',
                color: '#0f172a',
                fontWeight: 700,
                marginTop: '0.5rem',
              }}
            >
              {authMode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
            <button
              type="button"
              onClick={() => setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                background: 'transparent',
                color: '#e2e8f0',
                marginTop: '0.75rem',
              }}
            >
              {authMode === 'login' ? 'Нужна регистрация?' : 'Уже есть аккаунт?'}
            </button>
          </form>
          <article
            style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '1rem',
              padding: '1.5rem',
              lineHeight: 1.6,
            }}
          >
            <h3>Как начать</h3>
            <ol style={{ paddingLeft: '1.25rem' }}>
              <li>Создайте аккаунт и укажите ваш Telegram ID.</li>
              <li>Добавьте контракт токена и задайте порог спреда.</li>
              <li>Получайте обновления в режиме реального времени и уведомления в Telegram.</li>
            </ol>
          </article>
        </section>
      ) : (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 0.8fr',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '1rem',
              padding: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Отслеживаемые токены</h2>
              <button
                onClick={() => loadMonitors()}
                disabled={loadingMonitors}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.75rem',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'transparent',
                  color: '#e2e8f0',
                }}
              >
                {loadingMonitors ? 'Обновление…' : 'Обновить'}
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(148, 163, 184, 0.2)' }}>
                    <th style={{ padding: '0.75rem' }}>Токен</th>
                    <th style={{ padding: '0.75rem' }}>MEXC</th>
                    <th style={{ padding: '0.75rem' }}>Jupiter</th>
                    <th style={{ padding: '0.75rem' }}>Спред %</th>
                    <th style={{ padding: '0.75rem' }}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {monitors.map((monitor) => {
                    const price = latestPrices[monitor.id];
                    return (
                      <tr
                        key={monitor.id}
                        onClick={() => setSelectedMonitorId(monitor.id)}
                        style={{
                          cursor: 'pointer',
                          background: monitor.id === selectedMonitorId ? 'rgba(37, 99, 235, 0.2)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ fontWeight: 600 }}>{monitor.displayName ?? monitor.contractAddress}</div>
                          <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{monitor.contractAddress}</div>
                        </td>
                        <td style={{ padding: '0.75rem' }}>{price?.mexcPrice?.toFixed(6) ?? '—'}</td>
                        <td style={{ padding: '0.75rem' }}>{price?.jupiterPrice?.toFixed(6) ?? '—'}</td>
                        <td style={{ padding: '0.75rem', color: (price?.spread ?? 0) > 0 ? '#22c55e' : '#f87171' }}>
                          {price?.spread?.toFixed(2) ?? '—'}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              const value = `${monitor.contractAddress} | MEXC: ${price?.mexcPrice ?? 'n/a'} | Jupiter: ${price?.jupiterPrice ?? 'n/a'} | Spread: ${price?.spread ?? 'n/a'}`;
                              copyToClipboard(value);
                            }}
                            style={{
                              padding: '0.4rem 0.75rem',
                              borderRadius: '0.75rem',
                              border: '1px solid rgba(148, 163, 184, 0.3)',
                              background: 'transparent',
                              color: '#e2e8f0',
                            }}
                          >
                            Копировать
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {monitors.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                        Добавьте первый контракт, чтобы начать мониторинг
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gap: '1.5rem',
            }}
          >
            <form
              onSubmit={handleCreateMonitor}
              style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '1rem',
                padding: '1.5rem',
              }}
            >
              <h3 style={{ marginTop: 0 }}>Добавить контракт</h3>
              {[
                { key: 'contractAddress', label: 'Контракт (Jupiter mint)', required: true },
                { key: 'mexcSymbol', label: 'MEXC symbol (например BTC_USDT)' },
                { key: 'jupiterMintAddress', label: 'Jupiter mint (если отличается)' },
                { key: 'displayName', label: 'Отображаемое название' },
              ].map((field) => (
                <label key={field.key} style={{ display: 'block', marginBottom: '0.75rem' }}>
                  {field.label}
                  <input
                    required={Boolean(field.required)}
                    value={(monitorForm as any)[field.key]}
                    onChange={(event) => setMonitorForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    style={{
                      width: '100%',
                      marginTop: '0.25rem',
                      padding: '0.5rem',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                    }}
                  />
                </label>
              ))}
              <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                Порог спреда (%)
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={monitorForm.spreadThreshold}
                  onChange={(event) => setMonitorForm((prev) => ({ ...prev, spreadThreshold: event.target.value }))}
                  style={{
                    width: '100%',
                    marginTop: '0.25rem',
                    padding: '0.5rem',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                  }}
                />
              </label>
              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: 'none',
                  background: 'linear-gradient(135deg, #22d3ee, #818cf8)',
                  color: '#0f172a',
                  fontWeight: 700,
                }}
              >
                Добавить
              </button>
            </form>

            <aside
              style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '1rem',
                padding: '1.5rem',
              }}
            >
              <h3 style={{ marginTop: 0 }}>Последние алерты</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {alerts.length === 0 && <li style={{ color: '#94a3b8' }}>Алертов ещё не было</li>}
                {alerts.map((alert) => (
                  <li key={alert} style={{ marginBottom: '0.5rem', color: '#facc15' }}>
                    {alert}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>
      )}

      {user && selectedMonitor && (
        <section
          style={{
            marginTop: '2rem',
            background: 'rgba(15, 23, 42, 0.8)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            borderRadius: '1rem',
            padding: '1.5rem',
          }}
        >
          <h2 style={{ marginTop: 0 }}>График: {selectedMonitor.displayName ?? selectedMonitor.contractAddress}</h2>
          <PriceChart data={chartData} />
        </section>
      )}
    </main>
  );
}

function PriceChart({ data }: { data: HistoryEntry[] }) {
  if (data.length === 0) {
    return <p style={{ color: '#94a3b8' }}>Недостаточно данных для отображения графика.</p>;
  }
  const width = 900;
  const height = 320;
  const padding = 40;
  const timestamps = data.map((point) => point.timestamp);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const mexcValues = data.map((point) => point.mexc).filter((value): value is number => value !== null);
  const jupiterValues = data.map((point) => point.jupiter).filter((value): value is number => value !== null);
  const allValues = [...mexcValues, ...jupiterValues];
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);

  const scaleX = (timestamp: number) =>
    padding + ((timestamp - minTime) / (maxTime - minTime || 1)) * (width - padding * 2);
  const scaleY = (value: number) =>
    height - padding - ((value - minValue) / (maxValue - minValue || 1)) * (height - padding * 2);

  const buildPath = (values: (number | null)[]) => {
    return values
      .map((value, index) => {
        if (value === null) return null;
        const x = scaleX(data[index].timestamp);
        const y = scaleY(value);
        return `${index === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .filter(Boolean)
      .join(' ');
  };

  const mexcPath = buildPath(data.map((point) => point.mexc));
  const jupiterPath = buildPath(data.map((point) => point.jupiter));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="grid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(148, 163, 184, 0.3)" />
          <stop offset="100%" stopColor="rgba(148, 163, 184, 0.05)" />
        </linearGradient>
      </defs>
      <rect x={padding} y={padding / 2} width={width - padding * 2} height={height - padding * 1.5} fill="url(#grid)" opacity={0.08} />
      <g stroke="rgba(148, 163, 184, 0.2)" strokeDasharray="4" strokeWidth={1}>
        {[0, 1, 2, 3, 4].map((index) => {
          const y = padding + (index / 4) * (height - padding * 1.5);
          return <line key={index} x1={padding} x2={width - padding} y1={y} y2={y} />;
        })}
      </g>
      <path d={mexcPath} fill="none" stroke="#38bdf8" strokeWidth={3} strokeLinecap="round" />
      <path d={jupiterPath} fill="none" stroke="#f472b6" strokeWidth={3} strokeLinecap="round" />
      <text x={padding} y={padding - 10} fill="#38bdf8" fontSize={14}>
        MEXC
      </text>
      <text x={padding + 60} y={padding - 10} fill="#f472b6" fontSize={14}>
        Jupiter
      </text>
    </svg>
  );
}
