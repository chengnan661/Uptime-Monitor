export function exportSlaCsv(monitors) {
  if (!monitors || monitors.length === 0) return;

  const headers = ['ID', 'Name', 'URL', 'Method', 'Status', 'Interval(s)', 'Tags', 'Created At'];
  const rows = monitors.map(m => [
    m.id,
    `"${(m.name || '').replace(/"/g, '""')}"`,
    `"${(m.url || '').replace(/"/g, '""')}"`,
    m.method || 'GET',
    m.status || 'UP',
    m.interval || 300,
    `"${(m.tags || '').replace(/"/g, '""')}"`,
    `"${m.created_at || ''}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `sla-report-${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
