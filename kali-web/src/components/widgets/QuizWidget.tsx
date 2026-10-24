/**
 * QuizWidget — one question at a time, in serif, with lettered options.
 *
 * After you answer, your choice and the right one are marked in words and with an icon (never by
 * colour alone), and the "why" appears under the options. Dots at the top show each question's
 * result; the footer counts right, wrong and pending.
 */

import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, X, RotateCcw } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { StreamingSpinner, isStreaming as isStreamingContent } from "./base/StreamingSpinner";
import { QUIZ_QUESTIONS } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
}

const LETTERS = "ABCDEFGH";

export function QuizWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const real = Array.isArray(d.questions) && d.questions.length > 0;
  const questions = useMemo(() => (real ? d.questions : QUIZ_QUESTIONS), [d, real]) as typeof QUIZ_QUESTIONS;
  const source = typeof d.source === "string" ? d.source : "";

  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));

  const total = questions.length;
  const done = qIdx >= total;
  const question = questions[Math.min(qIdx, total - 1)];
  const selected = answers[qIdx] ?? null;
  const answered = selected !== null;
  const right = answers.filter((a, i) => a !== null && a === questions[i]?.correct).length;
  const wrong = answers.filter((a, i) => a !== null && a !== questions[i]?.correct).length;
  const pending = total - right - wrong;

  const select = useCallback((idx: number) => {
    if (answered) return;
    setAnswers((a) => a.map((v, i) => (i === qIdx ? idx : v)));
  }, [answered, qIdx]);

  const restart = useCallback(() => { setAnswers(questions.map(() => null)); setQIdx(0); }, [questions]);

  useShellSubtitle(typeof d.topic === "string" ? d.topic : null);
  useShellSample(!isReal || !real);

  const onKey = (e: React.KeyboardEvent) => {
    const i = LETTERS.indexOf(e.key.toUpperCase());
    if (!answered && i >= 0 && i < question.options.length) { e.preventDefault(); select(i); }
    else if (answered && e.key === "Enter") { e.preventDefault(); setQIdx((q) => q + 1); }
  };

  return (
    <BaseWidget>
      <WidgetToolbar>
        <button type="button" className="tooltip w-6 h-6 rounded hover:bg-fg/10 text-muted hover:text-accent transition flex items-center justify-center" data-tip={t("v2.quiz.restart")} aria-label={t("v2.quiz.restart") as string} onClick={restart}>
          <RotateCcw size={14} />
        </button>
      </WidgetToolbar>
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="quiz" />
      ) : (
        <div className="kw-quiz scrollbar-thin" tabIndex={0} onKeyDown={onKey}>
          <div className="kw-quiz-inner">
            <div className="kw-quiz-progress">
              <div className="kw-quiz-dots" aria-hidden="true">
                {questions.map((q, i) => {
                  const a = answers[i];
                  const cls = i === qIdx && !done ? "is-current" : a === null ? "" : a === q.correct ? "is-ok" : "is-err";
                  return <span key={i} className={`kw-quiz-dot ${cls}`} />;
                })}
              </div>
              <span>{done ? t("v2.quiz.finished") : t("v2.quiz.question_of", { n: qIdx + 1, total })}</span>
            </div>

            {done ? (
              <div className="kw-quiz-result">
                <h3>{t("widget.quiz.score", { score: right, total })}</h3>
                <p>{right === total ? t("v2.quiz.perfect") : t("v2.quiz.review_hint")}</p>
                <div className="flex gap-2">
                  <button type="button" className="v2-btn" onClick={() => setQIdx(0)}>{t("v2.quiz.review")}</button>
                  <button type="button" className="v2-btn is-primary" onClick={restart}>{t("v2.quiz.restart")}</button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="kw-quiz-question">{question.question}</h3>
                <div className="kw-quiz-options" role="radiogroup" aria-label={question.question}>
                  {question.options.map((opt, i) => {
                    const isRight = answered && i === question.correct;
                    const isMine = answered && i === selected && i !== question.correct;
                    return (
                      <button
                        key={i}
                        type="button"
                        role="radio"
                        aria-checked={selected === i}
                        disabled={answered && !isRight && !isMine}
                        className={`kw-quiz-option ${isRight ? "is-ok" : ""} ${isMine ? "is-err" : ""}`}
                        onClick={() => select(i)}
                      >
                        <span className="kw-quiz-letter">{LETTERS[i]}</span>
                        <span className="flex-1 text-left">{opt}</span>
                        {isMine && <span className="kw-quiz-tag is-err"><X size={14} aria-hidden="true" />{t("v2.quiz.yours")}</span>}
                        {isRight && <span className="kw-quiz-tag is-ok"><Check size={14} aria-hidden="true" />{t("v2.quiz.correct")}</span>}
                      </button>
                    );
                  })}
                </div>
                {answered && question.explanation && (
                  <div className="kw-quiz-why"><strong>{t("v2.quiz.why")}</strong> {question.explanation}</div>
                )}
                {answered && (
                  <div className="kw-quiz-next">
                    <button type="button" className="v2-btn is-primary" onClick={() => setQIdx((q) => q + 1)} autoFocus>
                      {qIdx < total - 1 ? t("v2.quiz.next") : t("widget.quiz.result")}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <WidgetFooter>
        <span className="v2-foot-item">{t("v2.quiz.right", { count: right })}</span>
        <span className="v2-foot-item">{t("v2.quiz.wrong", { count: wrong })}</span>
        <span className="v2-foot-item">{t("v2.quiz.pending", { count: pending })}</span>
        {source && <span className="v2-foot-item">{t("v2.quiz.from", { source })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
