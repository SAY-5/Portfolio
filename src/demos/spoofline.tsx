import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/demo.css';
import './spoofline.css';
import framesUrl from './spoofline/frames.webp';
import spectrogramsUrl from './spoofline/spectrograms.webp';
import {
  DETECTORS,
  abstainAt,
  atPrecision,
  calibrated,
  countsAt,
  curve,
  oddsFraction,
  precisionOf,
  recallOf,
  type CurvePoint,
  type OperatingPoint,
} from './spoofline/calibration';
import type { AbstainRow, ClipRow, Combo, Decision, DemoData, Detector, Fusion, Split, Stream } from './spoofline/types';

// Replayed from spoofline: every clip score on this page is a number the two
// trained CNN-LSTM streams produced in the repository's recorded run, copied
// from its exported reference file (raw logits, Platt calibrated probabilities,
// per stream flags, the weighted sum and logistic fusion decisions, and the
// stream that triggered the weighted sum decision). No network runs here. The
// frame sheet and the spectrogram sheet are drawn from the same exported clips
// by spoofline/make_assets.py. The calibration view is live: it re-picks each
// threshold as the lowest calibrated probability whose precision on the 234
// calibration clips reaches the target, the rule calibrate.py uses, keeps the
// fitted Platt maps, fusion weight and logistic coefficients, counts the test
// split at those thresholds, and applies the abstain margin the same way
// robustness.py does. The headline figures are the run's committed metrics,
// sweep and robustness tables.

const SOURCE = 'https://github.com/SAY-5/spoofline/tree/main/web';
const DEFAULT_CLIP = 'clip_00039';
const FRAME_MS = 125;
// Hop length of the exported log mel features, in samples.
const HOP_LENGTH = 160;
const TARGET_MIN = 0.8;
const TARGET_MAX = 1;
const P_MIN = 0.6;
const SCALE_TICKS = [0.01, 0.1, 0.5, 0.9, 0.99];
const ease = [0.22, 1, 0.36, 1] as const;

const FAMILY_LABEL: Record<string, string> = {
  bonafide: 'Bona fide',
  video_replay: 'Screen replay',
  video_print: 'Print',
  video_splice: 'Face splice',
  video_recompress: 'Recompression',
  audio_replay: 'Room replay',
  audio_vocoder: 'Vocoder',
  audio_conversion: 'Voice conversion',
  audio_splice: 'Speaker splice',
};

const GROUPS: { combo: Combo; title: string }[] = [
  { combo: 'bonafide', title: 'Bona fide' },
  { combo: 'video_only', title: 'Video attacked, audio untouched' },
  { combo: 'audio_only', title: 'Audio attacked, video untouched' },
  { combo: 'both', title: 'Both attacked' },
];

const DETECTOR_NAME: Record<Detector, string> = { video: 'video', audio: 'audio', fused: 'fused', logistic: 'logistic' };
const FUSIONS: Fusion[] = ['fused', 'logistic'];
const FUSION_NAME: Record<Fusion, string> = { fused: 'weighted sum', logistic: 'logistic' };
const SPLITS: Split[] = ['seen', 'unseen'];

function fixed(value: number, digits = 3): string {
  return value.toFixed(digits);
}

function signed(value: number, digits = 4): string {
  return value >= 0 ? `+${value.toFixed(digits)}` : value.toFixed(digits);
}

function count(value: number): string {
  return String(Math.round(value));
}

function short(commit: string): string {
  return commit.slice(0, 7);
}

function clipTitle(clip: ClipRow): string {
  if (clip.combo === 'bonafide') return 'Bona fide';
  return [clip.videoFamily, clip.audioFamily]
    .filter((f) => f !== 'bonafide')
    .map((f) => FAMILY_LABEL[f] ?? f)
    .join(' + ');
}

function outcomeOf(decision: Decision, label: 0 | 1): string {
  const attack = decision === 'attack';
  if (label === 1) return attack ? 'attack caught' : 'attack missed';
  return attack ? 'false alarm' : 'correctly passed';
}

function streamOf(clip: ClipRow, stream: Stream) {
  return stream === 'video'
    ? { logit: clip.videoLogit, p: clip.videoProbability, flags: clip.videoFlags, family: clip.videoFamily }
    : { logit: clip.audioLogit, p: clip.audioProbability, flags: clip.audioFlags, family: clip.audioFamily };
}

function fusionNote(clip: ClipRow, data: DemoData): string {
  const { weight: w, threshold } = data.calibration.fused;
  const t = fixed(threshold, 4);
  const videoTerm = w * clip.videoProbability;
  const attack = clip.decision === 'attack';
  if (clip.videoFlags && clip.audioFlags) return `Both streams flag this clip, and the fused score ${fixed(clip.fusedProbability, 4)} clears ${t}.`;
  if (!clip.videoFlags && !clip.audioFlags) {
    return attack
      ? `Neither stream crosses its own threshold, yet the fused score ${fixed(clip.fusedProbability, 4)} clears ${t}: with ${fixed(w, 2)} on video the fused score is mostly the audio probability, and the fused threshold sits far below the audio stream's own ${fixed(data.calibration.audio.threshold, 4)}.`
      : `Neither stream crosses its own threshold and the fused score ${fixed(clip.fusedProbability, 4)} stays under ${t}.`;
  }
  if (clip.videoFlags) {
    return attack
      ? `Only the video stream flags this clip. Its weighted term ${fixed(w, 2)} × ${fixed(clip.videoProbability, 4)} = ${fixed(videoTerm, 4)} ${videoTerm >= threshold ? 'clears the fused threshold on its own' : 'needs the audio term to reach the fused threshold'}.`
      : `The video stream flags this clip, but its weighted term ${fixed(w, 2)} × ${fixed(clip.videoProbability, 4)} = ${fixed(videoTerm, 4)} is too small, so the fused score ${fixed(clip.fusedProbability, 4)} stays under ${t}.`;
  }
  return attack
    ? `Only the audio stream flags this clip, and at ${fixed(1 - w, 2)} weight its term carries the fused score to ${fixed(clip.fusedProbability, 4)}.`
    : `The audio stream flags this clip, but the fused score ${fixed(clip.fusedProbability, 4)} stays under ${t}.`;
}

function logisticNote(clip: ClipRow, data: DemoData): string {
  const c = data.calibration.logistic.coefficients;
  const gap = Math.abs(clip.videoProbability - clip.audioProbability);
  const agree = clip.logisticDecision === clip.decision;
  const lead = agree
    ? `Both fusions reach the same decision on this clip.`
    : `The two fusions disagree on this clip: the weighted sum says ${clip.decision}, the logistic fusion says ${clip.logisticDecision}.`;
  const why =
    c.p_video > c.p_audio
      ? `The logistic fusion puts more weight on video (${fixed(c.p_video)} against ${fixed(c.p_audio)}) and adds ${fixed(c.disagreement)} times the disagreement, ${fixed(gap, 4)} here, so a clip one stream is sure about can clear its threshold ${fixed(data.calibration.logistic.threshold, 4)}.`
      : `The logistic fusion adds ${fixed(c.disagreement)} times the disagreement, ${fixed(gap, 4)} here, to its weighted probabilities.`;
  return `${lead} ${why} The repository keeps the weighted sum as its primary decision and reports the logistic fusion beside it.`;
}

function sheet(url: string, cols: number, rows: number, col: number, row: number): CSSProperties {
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
  };
}

function falseAlarmRow(data: DemoData, perturbation: string, severity: number) {
  return data.robustness.falseAlarms.find((r) => r.perturbation === perturbation && r.severity === severity);
}

export default function SpooflineDemo() {
  const [data, setData] = useState<DemoData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    import('./spoofline/data.json?raw')
      .then((mod) => {
        if (live) setData(JSON.parse(mod.default) as DemoData);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="demo" aria-label="spoofline two-stream spoof detection demo">
      <span className="demo__tag">Interactive demo</span>
      <h3 className="demo__title">Two streams, calibrated per stream, fused two ways</h3>
      <p className="demo__lede">
        Each held out test clip shows its 16 frames, its log mel spectrogram, the raw score of the
        video and audio CNN-LSTM, the Platt calibrated probability against each stream's threshold,
        the weighted sum and logistic fusion decisions, and the stream that triggered the weighted
        sum. Clip scores are replayed from the trained model's run and are not computed on this
        page; the calibration view below does recompute thresholds and the abstain rule live from
        the exported calibration and test scores.
      </p>
      <p className="sl__source">
        The repository's own browser demo runs both networks live with onnxruntime-web:{' '}
        <a href={SOURCE} target="_blank" rel="noreferrer">
          SAY-5/spoofline/web
        </a>
        {data ? (
          <>
            , exported behind a {data.export.tolerance.toExponential(0)} parity gate against PyTorch (measured{' '}
            {data.export.parity.video.toExponential(2)} on video and {data.export.parity.audio.toExponential(2)} on audio over{' '}
            {data.export.parityClips} clips, export.json of the run) and re-scored by the repository's self check.
          </>
        ) : (
          '.'
        )}
      </p>
      {data ? (
        <Loaded data={data} />
      ) : (
        <p className="sl__loading" role="status">
          {failed ? 'The run data could not be loaded.' : 'Loading the run data'}
        </p>
      )}
    </div>
  );
}

function Loaded({ data }: { data: DemoData }) {
  const reduce = useReducedMotion() ?? false;
  const [selected, setSelected] = useState(() => (data.clips.some((c) => c.id === DEFAULT_CLIP) ? DEFAULT_CLIP : data.clips[0].id));
  const clip = data.clips.find((c) => c.id === selected) ?? data.clips[0];

  return (
    <div className="sl__stage">
      <section className="sl__panel" aria-label="Clip picker">
        <div className="sl__panel-head">
          <span className="sl__panel-title">held out test clips</span>
          <span className="sl__panel-meta">
            {data.clips.length} clips from the test identities; unseen marks a family held out of training
          </span>
        </div>
        <div className="sl__groups">
          {GROUPS.map((group) => (
            <div key={group.combo} className="sl__group" role="group" aria-label={group.title}>
              <span className="sl__group-title">{group.title}</span>
              <div className="sl__chips">
                {data.clips
                  .filter((c) => c.combo === group.combo)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="sl__chip"
                      aria-pressed={c.id === selected}
                      data-clip={c.id}
                      onClick={() => setSelected(c.id)}
                    >
                      <span>{clipTitle(c)}</span>
                      <span className="sl__chip-meta">
                        #{c.id.replace('clip_', '')}
                        {c.unseen && <span className="sl__unseen">unseen</span>}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <ClipView data={data} clip={clip} reduce={reduce} />
      <Scores data={data} clip={clip} reduce={reduce} />
      <Calibration data={data} />
      <Headline data={data} />
    </div>
  );
}

function ClipView({ data, clip, reduce }: { data: DemoData; clip: ClipRow; reduce: boolean }) {
  const { cols, rows } = data.sheets.frames;
  const perClip = cols * rows;
  const bands = data.clips.length;
  const [tick, setTick] = useState(0);
  const [pinned, setPinned] = useState<number | null>(null);
  const playing = !reduce && pinned === null;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTick((t) => (t + 1) % perClip), FRAME_MS);
    return () => window.clearInterval(id);
  }, [playing, perClip]);

  const frame = pinned ?? (reduce ? Math.floor(perClip / 2) - 1 : tick);
  const spec = data.sheets.spectrogram;
  const seconds = ((spec.frames - 1) * HOP_LENGTH) / data.corpus.sample_rate;

  return (
    <section className="sl__panel" aria-label="Clip frames and spectrogram">
      <div className="sl__panel-head">
        <span className="sl__panel-title">{clipTitle(clip)}</span>
        <span className="sl__panel-meta">
          {clip.id}, {clip.identity}, {clip.split === 'unseen_test' ? 'unseen family test split' : 'seen family test split'}
        </span>
      </div>
      <div className="sl__clip">
        <div className="sl__viewer">
          <div
            className="sl__frame"
            role="img"
            aria-label={`Frame ${frame + 1} of ${perClip} from ${clip.id}`}
            style={sheet(framesUrl, cols, bands * rows, frame % cols, clip.band * rows + Math.floor(frame / cols))}
          />
          <div className="sl__viewer-row">
            <span>
              frame {frame + 1} / {perClip}
            </span>
            <button type="button" className="sl__mini" onClick={() => setPinned(pinned === null ? frame : null)} disabled={reduce && pinned === null}>
              {playing ? 'pause' : 'play'}
            </button>
          </div>
        </div>
        <div className="sl__media">
          <span className="sl__label">
            all {perClip} frames, {data.corpus.frame_size}x{data.corpus.frame_size}
          </span>
          <div className="sl__sheet sl__sheet--strip" style={sheet(framesUrl, 1, bands, 0, clip.band)}>
            {Array.from({ length: perClip }, (_, k) => (
              <button
                key={k}
                type="button"
                className="sl__tile"
                data-on={k === frame}
                aria-label={`Show frame ${k + 1}`}
                onClick={() => setPinned(k)}
              />
            ))}
          </div>
          <span className="sl__label">
            log mel spectrogram, {spec.bands} bands low to high from the bottom, {spec.frames} frames, log power {spec.low} to {spec.high}
          </span>
          <div
            className="sl__sheet sl__sheet--spec"
            role="img"
            aria-label={`Log mel spectrogram of ${clip.id}`}
            style={sheet(spectrogramsUrl, 1, bands, 0, clip.band)}
          >
            <span className="sl__playhead" style={{ left: `${((frame + 0.5) / perClip) * 100}%` }} />
          </div>
          <div className="sl__axis" aria-hidden="true">
            <span>0 s</span>
            <span>{fixed(seconds / 2, 0)} s</span>
            <span>{fixed(seconds, 0)} s</span>
          </div>
          <dl className="sl__truth">
            {(['video', 'audio'] as Stream[]).map((stream) => {
              const family = streamOf(clip, stream).family;
              return (
                <div key={stream}>
                  <dt>{stream} stream</dt>
                  <dd>
                    {family === 'bonafide' ? (
                      <>
                        <b>untouched</b>
                      </>
                    ) : (
                      <>
                        <b>{FAMILY_LABEL[family] ?? family}</b>
                        {data.unseenFamilies.includes(family) ? ' (held out of training)' : ''}: {data.families[family]}
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </section>
  );
}

function OddsBar({ value, threshold, reduce }: { value: number; threshold: number; reduce: boolean }) {
  return (
    <div aria-hidden="true">
      <div className="sl__bar">
        <motion.span
          className="sl__bar-fill"
          initial={false}
          animate={{ width: `${oddsFraction(value) * 100}%` }}
          transition={reduce ? { duration: 0 } : { duration: 0.4, ease }}
        />
        <span className="sl__bar-tick" style={{ left: `${oddsFraction(threshold) * 100}%` }} />
      </div>
      <div className="sl__scale">
        {SCALE_TICKS.map((t) => (
          <span key={t} style={{ left: `${oddsFraction(t) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Scores({ data, clip, reduce }: { data: DemoData; clip: ClipRow; reduce: boolean }) {
  const fused = data.calibration.fused;
  const logistic = data.calibration.logistic;
  const c = logistic.coefficients;
  const attack = clip.decision === 'attack';
  const logisticAttack = clip.logisticDecision === 'attack';
  return (
    <section className="sl__panel" aria-label="Scores from the run" aria-live="polite">
      <div className="sl__panel-head">
        <span className="sl__panel-title">scores from the run</span>
        <span className="sl__panel-meta">PyTorch outputs replayed from the exported reference file of seed {data.seed}, log odds scale</span>
      </div>
      <div className="sl__cards">
        {(['video', 'audio'] as Stream[]).map((stream) => {
          const s = streamOf(clip, stream);
          const cal = data.calibration[stream];
          const attacked = s.family !== 'bonafide';
          return (
            <article key={stream} className="sl__card" data-flag={s.flags} data-stream={stream}>
              <header className="sl__card-head">
                <span className="sl__card-name">{stream === 'video' ? 'Video stream' : 'Audio stream'}</span>
                <span className="sl__card-truth">{attacked ? `${stream} attacked` : `${stream} untouched`}</span>
              </header>
              <dl className="sl__readout">
                <div>
                  <dt>raw logit</dt>
                  <dd data-field="logit">{signed(s.logit)}</dd>
                </div>
                <div>
                  <dt>calibrated p</dt>
                  <dd data-field="probability">{fixed(s.p, 4)}</dd>
                </div>
                <div>
                  <dt>threshold</dt>
                  <dd data-field="threshold">{fixed(cal.threshold, 4)}</dd>
                </div>
              </dl>
              <p className="sl__formula">
                p = sigmoid({fixed(cal.a)} s {cal.b < 0 ? '-' : '+'} {fixed(Math.abs(cal.b))})
              </p>
              <OddsBar value={s.p} threshold={cal.threshold} reduce={reduce} />
              <footer className="sl__card-foot">
                <span className="sl__verdict" data-flag={s.flags} data-field="verdict">
                  {s.flags ? 'flags' : 'passes'}
                </span>
                <span className="sl__outcome">
                  {s.flags === attacked ? 'agrees with its stream label' : attacked ? 'misses its attack' : 'flags an untouched stream'}
                </span>
              </footer>
            </article>
          );
        })}
        <article className="sl__card sl__card--fused" data-flag={attack} data-stream="fused">
          <header className="sl__card-head">
            <span className="sl__card-name">Weighted sum</span>
            <span className="sl__card-truth">{clip.label ? 'attack clip' : 'bona fide clip'}, the run's primary decision</span>
          </header>
          <p className="sl__formula">
            {fixed(fused.weight, 2)} × {fixed(clip.videoProbability, 4)} + {fixed(1 - fused.weight, 2)} × {fixed(clip.audioProbability, 4)} ={' '}
            <b data-field="fused">{fixed(clip.fusedProbability, 4)}</b>
          </p>
          <dl className="sl__readout">
            <div>
              <dt>fused threshold</dt>
              <dd>{fixed(fused.threshold, 4)}</dd>
            </div>
            <div>
              <dt>weight on video</dt>
              <dd>{fixed(fused.weight, 2)}</dd>
            </div>
            <div>
              <dt>triggered by</dt>
              <dd data-field="triggered-by">{clip.triggeredBy}</dd>
            </div>
          </dl>
          <OddsBar value={clip.fusedProbability} threshold={fused.threshold} reduce={reduce} />
          <footer className="sl__card-foot">
            <span className="sl__verdict" data-flag={attack} data-field="decision">
              {attack ? 'attack' : 'bona fide'}
            </span>
            <span className="sl__outcome" data-field="outcome">
              {outcomeOf(clip.decision, clip.label)}
            </span>
          </footer>
          <p className="sl__note">
            {fusionNote(clip, data)} Triggered by is the run's attribution: silence one stream at a time and see which alone
            keeps the clip flagged (video, audio, either, joint) or none when it is not flagged.
          </p>
        </article>
        <article className="sl__card sl__card--logistic" data-flag={logisticAttack} data-stream="logistic">
          <header className="sl__card-head">
            <span className="sl__card-name">Logistic fusion</span>
            <span className="sl__card-truth">{clip.label ? 'attack clip' : 'bona fide clip'}, reported beside it</span>
          </header>
          <p className="sl__formula">
            sigmoid({fixed(c.p_video)} × {fixed(clip.videoProbability, 4)} + {fixed(c.p_audio)} × {fixed(clip.audioProbability, 4)} +{' '}
            {fixed(c.disagreement)} × {fixed(Math.abs(clip.videoProbability - clip.audioProbability), 4)} {logistic.intercept < 0 ? '-' : '+'}{' '}
            {fixed(Math.abs(logistic.intercept))}) = <b data-field="logistic">{fixed(clip.logisticProbability, 4)}</b>
          </p>
          <dl className="sl__readout">
            <div>
              <dt>logistic threshold</dt>
              <dd>{fixed(logistic.threshold, 4)}</dd>
            </div>
            <div>
              <dt>on |p video - p audio|</dt>
              <dd>{fixed(c.disagreement)}</dd>
            </div>
            <div>
              <dt>intercept</dt>
              <dd>{fixed(logistic.intercept)}</dd>
            </div>
          </dl>
          <OddsBar value={clip.logisticProbability} threshold={logistic.threshold} reduce={reduce} />
          <footer className="sl__card-foot">
            <span className="sl__verdict" data-flag={logisticAttack} data-field="logistic-decision">
              {logisticAttack ? 'attack' : 'bona fide'}
            </span>
            <span className="sl__outcome" data-field="logistic-outcome">
              {outcomeOf(clip.logisticDecision, clip.label)}
            </span>
          </footer>
          <p className="sl__note">{logisticNote(clip, data)}</p>
        </article>
      </div>
    </section>
  );
}

const PR = { width: 360, height: 250, left: 42, right: 14, top: 14, bottom: 38 };

function prX(recall: number): number {
  return PR.left + recall * (PR.width - PR.left - PR.right);
}

function prY(precision: number): number {
  const p = Math.min(1, Math.max(P_MIN, precision));
  return PR.top + (1 - (p - P_MIN) / (1 - P_MIN)) * (PR.height - PR.top - PR.bottom);
}

function Marker({ detector, x, y }: { detector: Detector; x: number; y: number }) {
  if (detector === 'video') return <rect className="sl__mk--video" x={x - 4} y={y - 4} width={8} height={8} />;
  if (detector === 'audio') return <path className="sl__mk--audio" d={`M${x},${y - 5}L${x + 5},${y + 4}L${x - 5},${y + 4}Z`} />;
  if (detector === 'logistic') return <path className="sl__mk--logistic" d={`M${x},${y - 5.5}L${x + 5.5},${y}L${x},${y + 5.5}L${x - 5.5},${y}Z`} />;
  return <circle className="sl__mk--fused" cx={x} cy={y} r={4.5} />;
}

function PrChart({
  curves,
  points,
  target,
  onTarget,
}: {
  curves: Record<Detector, CurvePoint[]>;
  points: Record<Detector, OperatingPoint>;
  target: number;
  onTarget: (value: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  function move(event: PointerEvent<SVGRectElement>) {
    if (!dragging.current) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const y = ((event.clientY - rect.top) / rect.height) * PR.height;
    const p = P_MIN + (1 - (y - PR.top) / (PR.height - PR.top - PR.bottom)) * (1 - P_MIN);
    onTarget(Math.round(Math.min(TARGET_MAX, Math.max(TARGET_MIN, p)) * 1000) / 1000);
  }

  const yTarget = prY(target);
  const summary = DETECTORS.map((d) => `${d} recall ${fixed(points[d].recall)}`).join(', ');
  return (
    <div>
      <svg
        ref={svgRef}
        className="sl__svg"
        viewBox={`0 0 ${PR.width} ${PR.height}`}
        role="img"
        aria-label={`Precision against recall on the calibration split; at target ${fixed(target)}: ${summary}`}
      >
        {[0.6, 0.7, 0.8, 0.9, 1].map((p) => (
          <g key={p}>
            <line className="sl__grid" x1={PR.left} x2={PR.width - PR.right} y1={prY(p)} y2={prY(p)} />
            <text className="sl__tick-label" x={PR.left - 6} y={prY(p)} dy="0.32em" textAnchor="end">
              {p.toFixed(1)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
          <text key={r} className="sl__tick-label" x={prX(r)} y={PR.height - PR.bottom + 14} textAnchor="middle">
            {r}
          </text>
        ))}
        <text className="sl__axis-title" x={(PR.left + PR.width - PR.right) / 2} y={PR.height - 6} textAnchor="middle">
          recall on the calibration split
        </text>
        <text
          className="sl__axis-title"
          x={0}
          y={0}
          transform={`translate(11,${(PR.top + PR.height - PR.bottom) / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          precision
        </text>
        {DETECTORS.map((d) => (
          <path
            key={d}
            className={`sl__series sl__series--${d}`}
            d={curves[d].map((p, i) => `${i ? 'L' : 'M'}${prX(p.recall).toFixed(1)},${prY(p.precision).toFixed(1)}`).join('')}
          />
        ))}
        <line className="sl__target" x1={PR.left} x2={PR.width - PR.right} y1={yTarget} y2={yTarget} />
        <text className="sl__target-label" x={PR.left + 6} y={yTarget - 6}>
          target {fixed(target)}
        </text>
        {DETECTORS.map((d) => (
          <Marker key={d} detector={d} x={prX(points[d].recall)} y={prY(points[d].precision)} />
        ))}
        <g className="sl__grip" transform={`translate(${PR.width - PR.right - 14},${yTarget})`} aria-hidden="true">
          <rect x={-11} y={-7} width={22} height={14} rx={3} />
          <line x1={-4} x2={-4} y1={-3} y2={3} />
          <line x1={0} x2={0} y1={-3} y2={3} />
          <line x1={4} x2={4} y1={-3} y2={3} />
        </g>
        <rect
          className="sl__hit"
          data-role="target-handle"
          x={PR.left}
          width={PR.width - PR.left - PR.right}
          y={yTarget - 14}
          height={28}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={move}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        />
      </svg>
      <div className="sl__legend" aria-hidden="true">
        <span>
          <i className="sl__key" /> video
        </span>
        <span>
          <i className="sl__key sl__key--audio" /> audio
        </span>
        <span>
          <i className="sl__key sl__key--fused" /> weighted sum
        </span>
        <span>
          <i className="sl__key sl__key--logistic" /> logistic
        </span>
        <span>markers sit at each operating point</span>
      </div>
    </div>
  );
}

function Lane({ name, scores, labels, threshold }: { name: string; scores: Float64Array; labels: number[]; threshold: number }) {
  const c = countsAt(scores, labels, threshold);
  const x = (p: number) => 4 + oddsFraction(p) * 352;
  return (
    <div data-lane={name}>
      <div className="sl__lane-head">
        <b>{name}</b>
        <span>
          threshold {fixed(threshold, 4)}, flags {c.tp} of {c.tp + c.fn} attacks and {c.fp} of {c.fp + c.tn} bona fide
        </span>
      </div>
      <svg className="sl__svg" viewBox="0 0 360 40" role="img" aria-label={`${name} calibrated probabilities of the calibration clips against the threshold`}>
        <line className="sl__lane-base" x1={4} x2={356} y1={20} y2={20} />
        {Array.from(scores, (p, i) => {
          const attack = labels[i] === 1;
          const flagged = p >= threshold;
          const kind = attack ? (flagged ? 'tp' : 'fn') : flagged ? 'fp' : 'tn';
          const px = x(p).toFixed(1);
          return <line key={i} className={`sl__lane-${kind}`} x1={px} x2={px} y1={attack ? 3 : 23} y2={attack ? 17 : 37} />;
        })}
        <line className="sl__lane-threshold" x1={x(threshold)} x2={x(threshold)} y1={0} y2={40} />
      </svg>
    </div>
  );
}

function sameRow(a: AbstainRow, b: AbstainRow | undefined): boolean {
  if (!b) return false;
  return (
    a.kept === b.kept &&
    a.abstainedAttacks === b.abstainedAttacks &&
    a.abstainedBonafide === b.abstainedBonafide &&
    Math.abs(a.coverage - b.coverage) < 1e-9 &&
    Math.abs(a.precision - b.precision) < 1e-9 &&
    Math.abs(a.recall - b.recall) < 1e-9
  );
}

function Calibration({ data }: { data: DemoData }) {
  const [target, setTarget] = useState(data.targetPrecision);
  const [margin, setMargin] = useState(data.robustness.margins[0]);
  const cal = data.calibration;

  const base = useMemo(() => {
    const calib = calibrated(data, data.calib.video, data.calib.audio);
    const test = calibrated(data, data.test.video, data.test.audio);
    const curves = Object.fromEntries(DETECTORS.map((d) => [d, curve(calib[d], data.calib.label)])) as Record<Detector, CurvePoint[]>;
    return { calib, test, curves };
  }, [data]);

  const points = useMemo(
    () => Object.fromEntries(DETECTORS.map((d) => [d, atPrecision(base.curves[d], target)])) as Record<Detector, OperatingPoint>,
    [base, target],
  );

  const atRun = Math.abs(target - data.targetPrecision) < 1e-9;
  const runThreshold: Record<Detector, number> = {
    video: cal.video.threshold,
    audio: cal.audio.threshold,
    fused: cal.fused.threshold,
    logistic: cal.logistic.threshold,
  };
  const reproduces = DETECTORS.every((d) => Math.abs(points[d].threshold - runThreshold[d]) < 1e-12);

  const abstain = useMemo(
    () =>
      FUSIONS.map((fusion) =>
        SPLITS.map((split) => {
          const keep = (i: number) => data.test.unseen[i] === (split === 'unseen' ? 1 : 0);
          const row = abstainAt(base.test.video, base.test.audio, base.test[fusion], data.test.label, points[fusion].threshold, margin, keep);
          const measured = data.robustness.abstain[split][fusion].find((r) => Math.abs(r.margin - margin) < 1e-9);
          return { fusion, split, row, matches: sameRow(row, measured) };
        }),
      ).flat(),
    [base, data, points, margin],
  );
  const abstainReproduces = abstain.every((r) => r.matches);
  const noAbstain = margin >= 1;

  return (
    <section className="sl__panel" aria-label="Calibration">
      <div className="sl__panel-head">
        <span className="sl__panel-title">threshold at a target precision, computed here</span>
        <span className="sl__panel-meta">
          {data.calib.label.length} calibration clips, Platt maps, fusion weight {fixed(cal.fused.weight, 2)} and logistic coefficients held at the run's fit
        </span>
      </div>
      <div className="sl__controls">
        <label className="sl__slider">
          <span>target precision</span>
          <input
            type="range"
            min={TARGET_MIN}
            max={TARGET_MAX}
            step={0.001}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            aria-label="Target precision"
          />
          <output data-field="target">{fixed(target)}</output>
        </label>
        <button type="button" className="demo__btn demo__btn--ghost" onClick={() => setTarget(data.targetPrecision)} disabled={atRun}>
          reset to {fixed(data.targetPrecision, 2)}
        </button>
      </div>
      <div className="sl__calib">
        <PrChart curves={base.curves} points={points} target={target} onTarget={setTarget} />
        <div className="sl__lanes">
          {DETECTORS.map((d) => (
            <Lane key={d} name={DETECTOR_NAME[d]} scores={base.calib[d]} labels={data.calib.label} threshold={points[d].threshold} />
          ))}
          <p className="sl__hint">
            Drag the dashed target line or use the slider. Each lane places the calibration clips on a log odds axis from
            0.001 to 0.999, attacks above the line and bona fide below; lit ticks sit at or above the threshold. The threshold
            is the lowest calibrated probability whose precision reaches the target, which keeps the most recall at that
            precision.
          </p>
        </div>
      </div>
      <div className="sl__table-wrap">
        <table className="sl__table">
          <thead>
            <tr>
              <th scope="col">detector</th>
              <th scope="col">threshold</th>
              <th scope="col">calib P</th>
              <th scope="col">calib R</th>
              <th scope="col">seen P</th>
              <th scope="col">seen R</th>
              <th scope="col">unseen P</th>
              <th scope="col">unseen R</th>
              <th scope="col">unseen caught</th>
            </tr>
          </thead>
          <tbody>
            {DETECTORS.map((d) => {
              const threshold = points[d].threshold;
              const seen = countsAt(base.test[d], data.test.label, threshold, (i) => data.test.unseen[i] === 0);
              const unseen = countsAt(base.test[d], data.test.label, threshold, (i) => data.test.unseen[i] === 1);
              return (
                <tr key={d} data-detector={d} data-fused={d === 'fused'}>
                  <th scope="row">{DETECTOR_NAME[d]}</th>
                  <td data-field="threshold">{fixed(threshold, 4)}</td>
                  <td>
                    {fixed(points[d].precision)}
                    {points[d].reached ? '' : ' (target not met)'}
                  </td>
                  <td data-field="calib-recall">{fixed(points[d].recall)}</td>
                  <td>{fixed(precisionOf(seen))}</td>
                  <td>{fixed(recallOf(seen))}</td>
                  <td data-field="unseen-precision">{fixed(precisionOf(unseen))}</td>
                  <td>{fixed(recallOf(unseen))}</td>
                  <td>
                    {unseen.tp} / {unseen.tp + unseen.fn}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sl__table-note">
        {atRun && reproduces
          ? `At the run's target of ${fixed(data.targetPrecision, 2)} the re-picked thresholds equal the exported ones for all four detectors, so the test columns match the measured table.`
          : `Thresholds re-picked at target ${fixed(target)} on the calibration split, then the exported test split logits counted at those thresholds.`}
      </p>
      <div className="sl__abstain">
        <div className="sl__abstain-head">
          <span className="sl__abstain-title">abstain when the streams disagree, computed here</span>
          <div className="sl__margins" role="group" aria-label="Abstain margin">
            <span>margin</span>
            {data.robustness.margins.map((m) => (
              <button key={m} type="button" className="sl__margin" aria-pressed={Math.abs(m - margin) < 1e-9} onClick={() => setMargin(m)}>
                {m >= 1 ? 'never' : fixed(m, 2)}
              </button>
            ))}
          </div>
        </div>
        <div className="sl__table-wrap sl__table-wrap--tight">
          <table className="sl__table">
            <thead>
              <tr>
                <th scope="col">fusion</th>
                <th scope="col">split</th>
                <th scope="col">coverage</th>
                <th scope="col">kept P</th>
                <th scope="col">kept R</th>
                <th scope="col">attacks abstained</th>
                <th scope="col">bona fide abstained</th>
              </tr>
            </thead>
            <tbody>
              {abstain.map(({ fusion, split, row }) => (
                <tr key={`${fusion}-${split}`} data-fusion={fusion} data-split={split} data-fused={fusion === 'fused' && split === 'unseen'}>
                  <th scope="row">{FUSION_NAME[fusion]}</th>
                  <td>{split}</td>
                  <td data-field="coverage">{fixed(row.coverage)}</td>
                  <td data-field="kept-precision">{fixed(row.precision)}</td>
                  <td>{fixed(row.recall)}</td>
                  <td>{row.abstainedAttacks}</td>
                  <td>{row.abstainedBonafide}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sl__table-note" data-field="abstain-note">
          {noAbstain
            ? `A clip is abstained on when |p video - p audio| exceeds the margin; at "never" every clip is kept and the rows equal the table above. Precision and recall count only the kept clips.`
            : atRun && abstainReproduces
              ? `At the run's thresholds and margin ${fixed(margin, 2)} these rows equal the abstain block of robustness.json, the run's committed ladder (margins fixed before the run).`
              : `Margin ${fixed(margin, 2)} applied to the exported test logits at the thresholds re-picked above; robustness.json records the same ladder at the run's own thresholds.`}
        </p>
      </div>
    </section>
  );
}

function Headline({ data }: { data: DemoData }) {
  const u = data.metrics.unseen;
  const s = data.metrics.seen;
  const w = data.calibration.fused.weight;
  const target = data.targetPrecision;
  const bona = u.fused.n - u.fused.nPositive;
  const splice = data.familyRates.video_splice;
  const vocoder = data.familyRates.audio_vocoder;
  const sweep = data.sweep;
  const fusedSweep = sweep.unseen.fused.precision;
  const logisticSweep = sweep.unseen.logistic.precision;
  const videoSweep = sweep.unseen.video.precision;
  const clean = data.robustness.falseAlarms.find((r) => r.perturbation === 'clean') ?? data.robustness.falseAlarms[0];
  const noise = falseAlarmRow(data, 'audio_noise', 40);
  const resample = falseAlarmRow(data, 'resample', 12000);
  const bonaClips = data.robustness.bonafideClips.seen_test + data.robustness.bonafideClips.unseen_test;
  const stats = [
    {
      label: 'fused precision, unseen',
      value: fixed(u.fused.precision),
      sub: `target ${fixed(target, 2)}; ${fixed(s.fused.precision)} on seen families; one seed, ${fusedSweep.n} seeds of this pair average ${fixed(fusedSweep.mean)}, std ${fixed(fusedSweep.std)} (sweep.json)`,
      accent: true,
      field: 'fused-precision',
    },
    { label: 'video precision, unseen', value: fixed(u.video.precision), sub: `${u.video.tp} of ${u.video.nPositive} unseen attacks caught; ${fixed(videoSweep.mean)} in every sweep seed`, accent: false, field: 'video-precision' },
    { label: 'logistic precision, unseen', value: fixed(u.logistic.precision), sub: `${u.logistic.tp} of ${u.logistic.nPositive} caught; the run's second fusion, ${fixed(logisticSweep.mean)} over ${logisticSweep.n} seeds`, accent: false, field: 'logistic-precision' },
    { label: 'fused caught, unseen', value: `${u.fused.tp} / ${u.fused.nPositive}`, sub: `${u.fused.fp} false alarms on ${bona} bona fide clips, all ${data.attribution.unseen.fused.bonafide.audio} audio triggered`, accent: false, field: 'fused-caught' },
  ];
  return (
    <section className="sl__panel" aria-label="Measured on unseen attack families">
      <div className="sl__panel-head">
        <span className="sl__panel-title">measured on unseen attack families</span>
        <span className="sl__panel-meta">
          make demo, profile {data.profile}, seed {data.seed}, weights from commit {short(data.trainedFrom)} ({data.trainedFromDescribe}), held out{' '}
          {data.unseenFamilies.join(' and ')}, metrics from {data.runArtifacts.results}
        </span>
      </div>
      <div className="sl__stats">
        {stats.map((stat) => (
          <div key={stat.label} className="sl__stat" data-accent={stat.accent} data-field={stat.field}>
            <span className="sl__stat-label">{stat.label}</span>
            <span className="sl__stat-value">{stat.value}</span>
            <span className="sl__stat-sub">{stat.sub}</span>
          </div>
        ))}
      </div>
      <p className="sl__verdict-line" data-field="verdict">
        <span>verdict line printed by the run</span>
        {data.headline.verdict}
      </p>
      <div className="sl__prose">
        <p>
          On attack families held out of training, fused precision is <b>{fixed(u.fused.precision)}</b> against a calibration
          target of {fixed(target, 2)}, and below the video stream alone at <b>{fixed(u.video.precision)}</b>, which is the
          verdict the run prints. On seen families the same operating point measured {fixed(s.fused.precision)}.
        </p>
        <p>
          The video stream reaches {fixed(u.video.precision)} by flagging little: {u.video.tp} of {u.video.nPositive} unseen
          attacks, with {u.video.fp} false alarms on {bona} bona fide clips. It is blind by construction to a clip whose face is
          genuine and whose voice was vocoded.
        </p>
        <p>
          Fusion adds the audio stream, which lifts the catch to {u.fused.tp} of {u.fused.nPositive}. With a weight of{' '}
          {fixed(w, 2)} on video the fused score behaves close to an OR of the two streams, so it also takes on the audio
          stream's false alarms: {u.fused.tp} / ({u.fused.tp} + {u.fused.fp}) = {fixed(u.fused.precision)}. The fused detector
          trades a few points of precision for {u.fused.tp - u.video.tp} more caught attacks, with F1 {fixed(u.fused.f1)} and AUC{' '}
          {fixed(u.fused.auc)} against {fixed(u.video.f1)} and {fixed(u.video.auc)} for video. The logistic fusion over both
          probabilities and their disagreement, fitted on the same calibration split, reaches {fixed(u.logistic.precision)} here and
          catches {u.logistic.tp} of {u.logistic.nPositive}, still below video alone; the repository keeps the weighted sum as its
          primary decision and reports the logistic fusion beside it.
        </p>
        <p>
          This is one seed. Over {fusedSweep.n} seeds of the same held out pair at the {data.profile} profile ({data.runArtifacts.sweep}
          ) the fused unseen precision averages <b>{fixed(fusedSweep.mean)}</b> with a sample standard deviation of{' '}
          {fixed(fusedSweep.std)} and a bootstrap interval of {fixed(fusedSweep.ciLow)} to {fixed(fusedSweep.ciHigh)}, so this run sits
          at the bottom of that interval. Video alone holds {fixed(videoSweep.mean)} in all {videoSweep.n} runs and the logistic
          fusion averages {fixed(logisticSweep.mean)}, so neither fusion beats the best single stream on precision in any seed.
        </p>
        <p>
          Measured on clean capture only. On the same run's {bonaClips} bona fide test clips ({data.runArtifacts.robustness}) the
          weighted sum's false alarm rate is {fixed(clean.fused)} clean; Gaussian noise at{' '}
          {noise ? `${count(noise.severity ?? 0)} dB SNR lifts it to ${fixed(noise.fused)}` : 'the mildest severity lifts it'} and a
          round trip through {resample ? `${count((resample.severity ?? 0) / 1000)} kHz to ${fixed(resample.fused)}` : 'a lower rate lifts it further'},
          so the precision above does not survive benign audio degradation.
        </p>
        <p>
          The misses concentrate in the held out families: {count(splice.detected)} of {count(splice.n)} face splices and{' '}
          {count(vocoder.detected)} of {count(vocoder.n)} vocoded voices are caught. All figures describe the repository's
          deterministic generated corpus of {data.corpus.n_clips} clips from {data.corpus.n_identities} identities, one seed and
          one held out pair, not a public benchmark.
        </p>
      </div>
      <div className="sl__table-wrap">
        <table className="sl__table">
          <thead>
            <tr>
              <th scope="col">detector</th>
              <th scope="col">seen P</th>
              <th scope="col">seen R</th>
              <th scope="col">unseen P</th>
              <th scope="col">unseen R</th>
              <th scope="col">unseen F1</th>
              <th scope="col">unseen AUC</th>
              <th scope="col">unseen false alarms</th>
            </tr>
          </thead>
          <tbody>
            {DETECTORS.map((d) => (
              <tr key={d} data-fused={d === 'fused'}>
                <th scope="row">{DETECTOR_NAME[d]}</th>
                <td>{fixed(s[d].precision)}</td>
                <td>{fixed(s[d].recall)}</td>
                <td>{fixed(u[d].precision)}</td>
                <td>{fixed(u[d].recall)}</td>
                <td>{fixed(u[d].f1)}</td>
                <td>{fixed(u[d].auc)}</td>
                <td>
                  {u[d].fp} / {u[d].n - u[d].nPositive}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sl__table-note">Clip level metrics at the calibrated operating points, copied from {data.runArtifacts.results} of the run.</p>
    </section>
  );
}
