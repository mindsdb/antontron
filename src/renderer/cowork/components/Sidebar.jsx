import Ico from './Icons';

function NavItem({ icon, label, active, onClick, badge, comingSoon, primary }) {
  return (
    <button
      className={`nav-item${active ? ' active' : ''}${primary ? ' primary' : ''}`}
      onClick={comingSoon ? undefined : onClick}
      aria-label={label}
      data-coming-soon={comingSoon ? '' : undefined}
      style={comingSoon ? { opacity: 0.55, cursor: 'default' } : undefined}
    >
      <span style={{ color: active ? 'var(--primary-700)' : primary ? 'var(--primary-700)' : 'var(--frost-700)', display: 'inline-flex' }}>{icon}</span>
      <span style={{ flex: 1, fontWeight: primary ? 600 : undefined }}>{label}</span>
      {badge != null && (
        <span style={{
          fontSize: 11, color: 'var(--frost-600)',
          background: 'var(--stone-150)', borderRadius: 10,
          padding: '1px 6px', minWidth: 18, textAlign: 'center',
        }}>{badge}</span>
      )}
      {comingSoon && (
        <span style={{ fontSize: 10, color: 'var(--frost-500)', fontWeight: 500 }}>Soon</span>
      )}
    </button>
  );
}

function RecentItem({ task, active, onClick, onPin, onUnpin }) {
  return (
    <button className={`recent-item${active ? ' active' : ''}`} onClick={onClick} aria-label={task.title}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: task.status === 'active'
          ? 'var(--primary-400)'
          : task.status === 'done'
          ? 'var(--sage-400)'
          : 'var(--stone-300)',
      }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
      <span
        className="recent-pin"
        title={task.pinned ? 'Unpin task' : 'Pin task'}
        onClick={(event) => {
          event.stopPropagation();
          task.pinned ? onUnpin?.(task.id) : onPin?.(task);
        }}
      >
        {Ico.pin(12)}
      </span>
    </button>
  );
}

export default function Sidebar({
  tasks,
  pins = [],
  scheduledCount = 0,
  activeRoute,
  activeTaskId,
  serverOnline,
  onNavigate,
  onSelectTask,
  onNewTask,
  onOpenSearch,
  collapsed = false,
  onToggleCollapsed,
  onPinTask,
  onUnpinTask,
}) {
  const recents = tasks.slice(0, 8);
  const pinnedTasks = pins
    .filter((pin) => pin.type === 'task')
    .map((pin) => tasks.find((task) => task.id === pin.id) || { id: pin.id, title: pin.title || pin.id, status: 'idle', pinned: true })
    .slice(0, 8);

  return (
    <aside
      className={`app-sidebar${collapsed ? ' collapsed' : ''}`}
      style={{
        flexShrink: 0, height: '100%',
        background: 'var(--stone-50)',
        // Floating "bubble". Collapsed state animates width, opacity, and
        // a small translateX together with the same Apple-style spring
        // easing + duration so the bubble feels like one continuous motion
        // rather than three separate transitions resolving at different
        // moments. willChange hints at GPU acceleration.
        borderRadius: 14,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.05)',
        width: collapsed ? 0 : 'clamp(280px, 26vw, 320px)',
        opacity: collapsed ? 0 : 1,
        transform: collapsed ? 'translateX(-16px)' : 'translateX(0)',
        transition:
          'width 360ms cubic-bezier(0.32, 0.72, 0, 1), ' +
          'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1), ' +
          'transform 360ms cubic-bezier(0.32, 0.72, 0, 1)',
        willChange: 'width, opacity, transform',
        pointerEvents: collapsed ? 'none' : 'auto',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/*
        Sidebar header — single row, vertically aligned with the macOS
        traffic lights placed at (14, 18) by the main process. 88px left
        padding reserves space for those native buttons; the toggle and
        search buttons sit on the same horizontal line.

        Empty space drags the window (.drag-region); buttons stay clickable
        via the global no-drag rule on button/input/textarea/select.
      */}
      <div
        className="drag-region"
        style={{
          display: 'flex', alignItems: 'center',
          height: 56,
          // Asymmetric vertical padding: 10px bottom > 0px top shifts the
          // button row ~5px upward so it visually centers with the macOS
          // traffic lights (which sit slightly above the row's natural
          // midpoint).
          padding: '0 14px 10px 88px',
          gap: 4,
          flexShrink: 0,
        }}
      >
        <button
          className="icon-btn"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          {collapsed ? Ico.menu(15) : Ico.sidebar(15)}
        </button>
        <button
          className="icon-btn"
          onClick={onOpenSearch}
          title="Search (Cmd+K)"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          {Ico.search(15)}
        </button>
      </div>
      {/*
        Everything below the chrome row fades + clips when collapsed.
        We wrap the rest of the sidebar in a div with controlled opacity +
        pointer-events so it disappears with the width animation rather
        than fighting it.
      */}
      <div
        style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          // Match the bubble's easing so inner content fades in concert
          // with the slide instead of finishing earlier and feeling abrupt.
          transition: 'opacity 240ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >

      {/* Main nav */}
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <NavItem icon={Ico.plus(15)} label="New task" onClick={onNewTask} active={activeRoute === 'new'} primary />
        <NavItem icon={Ico.folder(15)} label="Projects" onClick={() => onNavigate('projects')} active={activeRoute === 'projects'} />
        <NavItem icon={Ico.clock(15)} label="Scheduled" onClick={() => onNavigate('scheduled')} active={activeRoute === 'scheduled'} badge={scheduledCount || null} />
        <NavItem icon={Ico.sparkle(15)} label="Live artifacts" onClick={() => onNavigate('artifacts')} active={activeRoute === 'artifacts'} />
        <NavItem icon={Ico.phone(15)} label="Dispatch" onClick={() => onNavigate('dispatch')} active={activeRoute === 'dispatch'} badge="Beta" />
        <NavItem icon={Ico.slider(15)} label="Customize" onClick={() => onNavigate('customize')} active={activeRoute === 'customize'} />
        <NavItem icon={Ico.settings(15)} label="Settings" onClick={() => onNavigate('settings')} active={activeRoute === 'settings'} />
      </div>

      {/* Anton extras */}
      <div style={{ padding: '4px 8px 0', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div className="section-label" style={{ paddingTop: 6 }}>Anton</div>
        <NavItem icon={Ico.brain(15)} label="Skills library" onClick={() => onNavigate('skills')} active={activeRoute === 'skills'} />
        <NavItem icon={Ico.brain(15)} label="Memory" onClick={() => onNavigate('memory')} active={activeRoute === 'memory'} />
        <NavItem icon={Ico.database(15)} label="Connect data" onClick={() => onNavigate('connect')} active={activeRoute === 'connect'} />
        <NavItem icon={Ico.upload(15)} label="Publish" onClick={() => onNavigate('publish')} active={activeRoute === 'publish'} />
      </div>

      {/* Pinned */}
      <div className="section-label">Pinned</div>
      <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {pinnedTasks.length ? pinnedTasks.map((task) => (
          <RecentItem
            key={task.id}
            task={{ ...task, pinned: true }}
            active={task.id === activeTaskId}
            onClick={() => onSelectTask(task.id)}
            onPin={onPinTask}
            onUnpin={onUnpinTask}
          />
        )) : (
          <div className="sidebar-empty">
            <span style={{ display: 'inline-flex' }}>{Ico.pin(12)}</span>
            <span>Visit or pin tasks to keep them here</span>
          </div>
        )}
      </div>

      {/* Recents */}
      <div className="section-label">Recents</div>
      <div className="scroll-clean" style={{ padding: '0 8px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {recents.map((t) => (
          <RecentItem
            key={t.id}
            task={t}
            active={t.id === activeTaskId}
            onClick={() => onSelectTask(t.id)}
            onPin={onPinTask}
            onUnpin={onUnpinTask}
          />
        ))}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--border-01)', padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--frost-700)', fontSize: 12 }}>
          {Ico.mindsdb(13)}
          <span>MindsDB</span>
        </div>
        <div style={{ flex: 1 }} />
        {/* Server status dot */}
        <span
          title={serverOnline ? 'Server online' : 'Server offline'}
          style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: serverOnline ? 'var(--sage-500)' : 'var(--stone-400)',
          }}
        />
        <button className="icon-btn" title="Updates (coming soon)" data-coming-soon="" style={{ width: 22, height: 22 }}>
          <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.download(13)}</span>
        </button>
      </div>
      </div>
    </aside>
  );
}
