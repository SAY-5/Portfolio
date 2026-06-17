import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './skillmatch.css';
import { useStore } from './skillmatch/state';
import {
  addPerson,
  addPersonSkill,
  addRole,
  addRoleSkill,
  deletePerson,
  deleteRole,
  removePersonSkill,
  removeRoleSkill,
  resetAll,
  updatePersonSkill,
  updateRoleSkill,
} from './skillmatch/store';
import {
  matchPercent,
  matchPersonToRole,
  rankPeopleForRole,
  rankRolesForPerson,
} from './skillmatch/engine';
import { MAX_LEVEL, MIN_LEVEL, type Gap } from './skillmatch/types';

// In-browser SkillMatch app. A role lists required skills, each with a needed
// level (1..5) and a weight; a person lists the skills they hold at a level.
// The engine computes weighted set overlap, ranks people for a role and roles
// for a person, and breaks every match down into its skill gaps. Everything is
// deterministic and runs client-side over localStorage. No eval anywhere.

type Tab = 'manage' | 'match' | 'gap';

// Render a skill id (a lowercase slug) as a readable label without storing a
// second copy. Pure, so it is safe to call during render.
function label(skillId: string): string {
  return skillId
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

const LEVELS = Array.from(
  { length: MAX_LEVEL - MIN_LEVEL + 1 },
  (_, i) => MIN_LEVEL + i,
);

export default function SkillMatchDemo() {
  const reduce = useReducedMotion();
  const { roles, people } = useStore();
  const [tab, setTab] = useState<Tab>('manage');

  // Selection for the match and gap views. Falls back to the first available
  // entity so the views are never empty when data exists.
  const [roleId, setRoleId] = useState<string>('role-backend');
  const [personId, setPersonId] = useState<string>('person-ada');

  const activeRole = roles.find((r) => r.id === roleId) ?? roles[0];
  const activePerson = people.find((p) => p.id === personId) ?? people[0];

  const rankedPeople = useMemo(
    () => (activeRole ? rankPeopleForRole(activeRole, people) : []),
    [activeRole, people],
  );
  const rankedRoles = useMemo(
    () => (activePerson ? rankRolesForPerson(activePerson, roles) : []),
    [activePerson, roles],
  );
  const pairMatch = useMemo(
    () =>
      activeRole && activePerson
        ? matchPersonToRole(activeRole, activePerson)
        : null,
    [activeRole, activePerson],
  );

  return (
    <div className="demo" aria-label="skillmatch skill matching demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Skill matching and gap analysis</h3>
      <p className="demo__lede">
        Define roles and the skills they need, define people and the skills they
        hold, then see ranked matches by weighted overlap and drill into the
        exact gaps to close. State persists in your browser.
      </p>

      <div className="sm2" data-reduce={reduce ? 'true' : 'false'}>
        <nav className="sm2__tabs" aria-label="views" role="tablist">
          <TabButton id="manage" tab={tab} setTab={setTab}>
            Roles &amp; people
          </TabButton>
          <TabButton id="match" tab={tab} setTab={setTab}>
            Matches
          </TabButton>
          <TabButton id="gap" tab={tab} setTab={setTab}>
            Gap detail
          </TabButton>
        </nav>

        {tab === 'manage' && <ManageView roles={roles} people={people} />}

        {tab === 'match' && (
          <MatchView
            roleId={activeRole?.id ?? ''}
            personId={activePerson?.id ?? ''}
            roles={roles}
            people={people}
            rankedPeople={rankedPeople}
            rankedRoles={rankedRoles}
            onRole={setRoleId}
            onPerson={setPersonId}
          />
        )}

        {tab === 'gap' && (
          <GapView
            roleId={activeRole?.id ?? ''}
            personId={activePerson?.id ?? ''}
            roles={roles}
            people={people}
            match={pairMatch}
            onRole={setRoleId}
            onPerson={setPersonId}
          />
        )}
      </div>

      <div className="demo__controls">
        <button
          className="demo__btn demo__btn--ghost"
          onClick={() => {
            resetAll();
            setRoleId('role-backend');
            setPersonId('person-ada');
          }}
        >
          Reset to seed
        </button>
        <span className="demo__hint">
          deterministic weighted overlap, persisted in localStorage, no eval
        </span>
      </div>
    </div>
  );
}

function TabButton({
  id,
  tab,
  setTab,
  children,
}: {
  id: Tab;
  tab: Tab;
  setTab: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = tab === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`sm2__tab ${active ? 'sm2__tab--active' : ''}`}
      onClick={() => setTab(id)}
    >
      {children}
    </button>
  );
}

// ---------- manage view ----------

function ManageView({
  roles,
  people,
}: {
  roles: ReturnType<typeof useStore>['roles'];
  people: ReturnType<typeof useStore>['people'];
}) {
  return (
    <div className="sm2__grid">
      <RolesPanel roles={roles} />
      <PeoplePanel people={people} />
    </div>
  );
}

function RolesPanel({ roles }: { roles: ReturnType<typeof useStore>['roles'] }) {
  const [name, setName] = useState('');
  return (
    <section className="sm2__panel glass" aria-labelledby="sm2-roles-h">
      <header className="sm2__panel-head">
        <h4 id="sm2-roles-h" className="sm2__panel-title">
          Roles
        </h4>
        <span className="sm2__panel-sub">{roles.length}</span>
      </header>

      <form
        className="sm2__add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          addRole(name);
          setName('');
        }}
      >
        <input
          className="sm2__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New role name"
          aria-label="new role name"
        />
        <button className="sm2__btn" type="submit">
          Add role
        </button>
      </form>

      <ul className="sm2__list">
        {roles.map((role) => (
          <li key={role.id} className="sm2__card">
            <div className="sm2__card-head">
              <span className="sm2__card-name">{role.name}</span>
              <button
                type="button"
                className="sm2__icon"
                aria-label={`delete role ${role.name}`}
                onClick={() => deleteRole(role.id)}
              >
                Remove
              </button>
            </div>
            <ul className="sm2__skills">
              {role.required.map((req) => (
                <li key={req.skillId} className="sm2__skill-row">
                  <span className="sm2__skill-name">{label(req.skillId)}</span>
                  <label className="sm2__field">
                    <span className="sm2__field-label">lvl</span>
                    <select
                      className="sm2__select"
                      value={req.level}
                      aria-label={`${label(req.skillId)} needed level`}
                      onChange={(e) =>
                        updateRoleSkill(role.id, req.skillId, {
                          level: Number(e.target.value),
                        })
                      }
                    >
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sm2__field">
                    <span className="sm2__field-label">wt</span>
                    <input
                      className="sm2__num"
                      type="number"
                      min={1}
                      max={9}
                      value={req.weight}
                      aria-label={`${label(req.skillId)} weight`}
                      onChange={(e) =>
                        updateRoleSkill(role.id, req.skillId, {
                          weight: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="sm2__icon"
                    aria-label={`remove ${label(req.skillId)} from ${role.name}`}
                    onClick={() => removeRoleSkill(role.id, req.skillId)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
            <AddSkillForm
              onAdd={(skillId, level, weight) =>
                addRoleSkill(role.id, { skillId, level, weight })
              }
              withWeight
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PeoplePanel({
  people,
}: {
  people: ReturnType<typeof useStore>['people'];
}) {
  const [name, setName] = useState('');
  return (
    <section className="sm2__panel glass" aria-labelledby="sm2-people-h">
      <header className="sm2__panel-head">
        <h4 id="sm2-people-h" className="sm2__panel-title">
          People
        </h4>
        <span className="sm2__panel-sub">{people.length}</span>
      </header>

      <form
        className="sm2__add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          addPerson(name);
          setName('');
        }}
      >
        <input
          className="sm2__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New person name"
          aria-label="new person name"
        />
        <button className="sm2__btn" type="submit">
          Add person
        </button>
      </form>

      <ul className="sm2__list">
        {people.map((person) => (
          <li key={person.id} className="sm2__card">
            <div className="sm2__card-head">
              <span className="sm2__card-name">{person.name}</span>
              <button
                type="button"
                className="sm2__icon"
                aria-label={`delete person ${person.name}`}
                onClick={() => deletePerson(person.id)}
              >
                Remove
              </button>
            </div>
            <ul className="sm2__skills">
              {person.skills.map((skill) => (
                <li key={skill.skillId} className="sm2__skill-row">
                  <span className="sm2__skill-name">
                    {label(skill.skillId)}
                  </span>
                  <label className="sm2__field">
                    <span className="sm2__field-label">lvl</span>
                    <select
                      className="sm2__select"
                      value={skill.level}
                      aria-label={`${label(skill.skillId)} held level`}
                      onChange={(e) =>
                        updatePersonSkill(
                          person.id,
                          skill.skillId,
                          Number(e.target.value),
                        )
                      }
                    >
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="sm2__icon"
                    aria-label={`remove ${label(skill.skillId)} from ${person.name}`}
                    onClick={() => removePersonSkill(person.id, skill.skillId)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
            <AddSkillForm
              onAdd={(skillId, level) =>
                addPersonSkill(person.id, { skillId, level })
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddSkillForm({
  onAdd,
  withWeight = false,
}: {
  onAdd: (skillId: string, level: number, weight: number) => void;
  withWeight?: boolean;
}) {
  const [skill, setSkill] = useState('');
  const [level, setLevel] = useState(3);
  const [weight, setWeight] = useState(1);
  return (
    <form
      className="sm2__add sm2__add--inline"
      onSubmit={(e) => {
        e.preventDefault();
        if (!skill.trim()) return;
        onAdd(skill, level, weight);
        setSkill('');
        setLevel(3);
        setWeight(1);
      }}
    >
      <input
        className="sm2__input"
        value={skill}
        onChange={(e) => setSkill(e.target.value)}
        placeholder="add skill (e.g. python)"
        aria-label="add skill name"
      />
      <label className="sm2__field">
        <span className="sm2__field-label">lvl</span>
        <select
          className="sm2__select"
          value={level}
          aria-label="skill level"
          onChange={(e) => setLevel(Number(e.target.value))}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {withWeight && (
        <label className="sm2__field">
          <span className="sm2__field-label">wt</span>
          <input
            className="sm2__num"
            type="number"
            min={1}
            max={9}
            value={weight}
            aria-label="skill weight"
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </label>
      )}
      <button className="sm2__btn sm2__btn--sm" type="submit">
        Add
      </button>
    </form>
  );
}

// ---------- match view ----------

function MatchView({
  roleId,
  personId,
  roles,
  people,
  rankedPeople,
  rankedRoles,
  onRole,
  onPerson,
}: {
  roleId: string;
  personId: string;
  roles: ReturnType<typeof useStore>['roles'];
  people: ReturnType<typeof useStore>['people'];
  rankedPeople: ReturnType<typeof rankPeopleForRole>;
  rankedRoles: ReturnType<typeof rankRolesForPerson>;
  onRole: (id: string) => void;
  onPerson: (id: string) => void;
}) {
  return (
    <div className="sm2__grid">
      <section className="sm2__panel glass" aria-labelledby="sm2-rp-h">
        <header className="sm2__panel-head">
          <h4 id="sm2-rp-h" className="sm2__panel-title">
            People for a role
          </h4>
        </header>
        <label className="sm2__picker">
          <span className="sm2__field-label">Role</span>
          <select
            className="sm2__select sm2__select--wide"
            value={roleId}
            onChange={(e) => onRole(e.target.value)}
            aria-label="pick a role to rank people"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <ol className="sm2__ranks">
          {rankedPeople.map((rp, i) => (
            <RankRow
              key={rp.person.id}
              rank={i + 1}
              name={rp.person.name}
              percent={matchPercent(rp.match.score)}
              gaps={rp.match.gaps}
            />
          ))}
          {rankedPeople.length === 0 && (
            <li className="sm2__empty">No people defined yet.</li>
          )}
        </ol>
      </section>

      <section className="sm2__panel glass" aria-labelledby="sm2-pr-h">
        <header className="sm2__panel-head">
          <h4 id="sm2-pr-h" className="sm2__panel-title">
            Roles for a person
          </h4>
        </header>
        <label className="sm2__picker">
          <span className="sm2__field-label">Person</span>
          <select
            className="sm2__select sm2__select--wide"
            value={personId}
            onChange={(e) => onPerson(e.target.value)}
            aria-label="pick a person to rank roles"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <ol className="sm2__ranks">
          {rankedRoles.map((rr, i) => (
            <RankRow
              key={rr.role.id}
              rank={i + 1}
              name={rr.role.name}
              percent={matchPercent(rr.match.score)}
              gaps={rr.match.gaps}
            />
          ))}
          {rankedRoles.length === 0 && (
            <li className="sm2__empty">No roles defined yet.</li>
          )}
        </ol>
      </section>
    </div>
  );
}

function RankRow({
  rank,
  name,
  percent,
  gaps,
}: {
  rank: number;
  name: string;
  percent: number;
  gaps: Gap[];
}) {
  const tone = percent >= 85 ? 'ok' : percent >= 60 ? 'mid' : 'low';
  return (
    <li className="sm2__rank">
      <span className="sm2__rank-no" aria-hidden="true">
        {rank}
      </span>
      <span className="sm2__rank-body">
        <span className="sm2__rank-name">{name}</span>
        <span className="sm2__bar" aria-hidden="true">
          <span
            className={`sm2__bar-fill sm2__bar-fill--${tone}`}
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="sm2__gaps">
          {gaps.length === 0 ? (
            <span className="sm2__gap sm2__gap--clear">all skills met</span>
          ) : (
            gaps.map((g) => (
              <span
                key={g.skillId}
                className={`sm2__gap ${g.missing ? 'sm2__gap--missing' : ''}`}
              >
                {labelOfGap(g)}
              </span>
            ))
          )}
        </span>
      </span>
      <span className={`sm2__pct sm2__pct--${tone}`}>
        {percent}
        <span className="sm2__pct-sign">%</span>
      </span>
    </li>
  );
}

function labelOfGap(g: Gap): string {
  const name = g.skillId
    .split('-')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
  return g.missing
    ? `${name}: missing (need ${g.needed})`
    : `${name}: ${g.held} of ${g.needed}, short ${g.deficit}`;
}

// ---------- gap view ----------

function GapView({
  roleId,
  personId,
  roles,
  people,
  match,
  onRole,
  onPerson,
}: {
  roleId: string;
  personId: string;
  roles: ReturnType<typeof useStore>['roles'];
  people: ReturnType<typeof useStore>['people'];
  match: ReturnType<typeof matchPersonToRole> | null;
  onRole: (id: string) => void;
  onPerson: (id: string) => void;
}) {
  const role = roles.find((r) => r.id === roleId);
  const person = people.find((p) => p.id === personId);
  const percent = match ? matchPercent(match.score) : 0;

  return (
    <section className="sm2__panel glass" aria-labelledby="sm2-gap-h">
      <header className="sm2__panel-head">
        <h4 id="sm2-gap-h" className="sm2__panel-title">
          Gap detail
        </h4>
        {match && <span className="sm2__panel-sub">{percent}% match</span>}
      </header>

      <div className="sm2__pair">
        <label className="sm2__picker">
          <span className="sm2__field-label">Role</span>
          <select
            className="sm2__select sm2__select--wide"
            value={roleId}
            onChange={(e) => onRole(e.target.value)}
            aria-label="role for gap detail"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sm2__picker">
          <span className="sm2__field-label">Person</span>
          <select
            className="sm2__select sm2__select--wide"
            value={personId}
            onChange={(e) => onPerson(e.target.value)}
            aria-label="person for gap detail"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!match || !role || !person ? (
        <p className="sm2__empty">Pick a role and a person to compare.</p>
      ) : match.gaps.length === 0 ? (
        <p className="sm2__cleared">
          {person.name} meets every required skill for {role.name}.
        </p>
      ) : (
        <table className="sm2__table">
          <caption className="sm2__caption">
            What {person.name} must close for {role.name}, hardest first
          </caption>
          <thead>
            <tr>
              <th scope="col">Skill</th>
              <th scope="col">Needed</th>
              <th scope="col">Held</th>
              <th scope="col">Close by</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {match.gaps.map((g) => (
              <tr key={g.skillId}>
                <th scope="row">{label(g.skillId)}</th>
                <td>{g.needed}</td>
                <td>{g.missing ? 'none' : g.held}</td>
                <td>
                  <span
                    className={`sm2__close ${g.missing ? 'sm2__close--missing' : ''}`}
                  >
                    +{g.deficit}
                  </span>
                </td>
                <td>{g.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
