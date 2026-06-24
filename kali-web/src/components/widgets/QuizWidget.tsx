import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { QUIZ_QUESTIONS } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function QuizWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const questions = useMemo(() => {
    if (d.questions && Array.isArray(d.questions)) return d.questions;
    return QUIZ_QUESTIONS;
  }, [d]) as typeof QUIZ_QUESTIONS;

  const [qIdx, setQIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const question = questions[qIdx];
  const total = questions.length;
  const done = qIdx >= total;

  const select = useCallback((idx: number) => {
    if (answered) return;
    setSelected(idx);
    setAnswered(true);
    if (idx === question.correct) setScore((s) => s + 1);
  }, [answered, question]);

  const next = useCallback(() => {
    setQIdx((i) => i + 1);
    setAnswered(false);
    setSelected(null);
  }, []);

  if (done) {
    return (
      <BaseWidget>
        <div className="p-4 text-center space-y-3">
          <div className="text-2xl">{score === total ? '\u{1F3C6}' : '\u2705'}</div>
          <div className="text-sm text-fg">Score: {score}/{total}</div>
          <div className="flex items-center justify-center gap-1">
            {questions.map((_, i) => (
              <span key={i} className={`quiz-score-dot w-2 h-2 rounded-full ${i < score ? "bg-ok" : "bg-white/10"}`} />
            ))}
          </div>
        </div>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget>
      <div className="p-3 space-y-3">
        {/* Progress dots */}
        <div className="flex items-center gap-1">
          {questions.map((_, i) => (
            <div key={i} className={`flex-1 h-1 rounded-full ${i <= qIdx ? "bg-accent" : "bg-white/10"}`} />
          ))}
        </div>

        {/* Question */}
        <div className="text-sm text-fg font-medium">{question.question}</div>

        {/* Options */}
        <div className="space-y-1">
          {question.options.map((opt, i) => (
            <div
              key={i}
              onClick={() => select(i)}
              className={`quiz-option px-3 py-2 rounded-lg border text-xs ${
                answered
                  ? i === question.correct
                    ? "correct border-ok/40 bg-ok/10"
                    : i === selected
                      ? "wrong border-err/40 bg-err/10"
                      : "border-white/5 bg-white/[0.02]"
                  : "border-white/5 bg-white/[0.02] hover:bg-white/[0.06]"
              }`}
            >
              {opt}
            </div>
          ))}
        </div>

        {/* Explanation */}
        {answered && (
          <div className="text-xs text-muted bg-accent/5 border border-accent/20 rounded-lg p-2">
            {question.explanation}
          </div>
        )}

        {/* Next button */}
        {answered && (
          <button onClick={next} className="w-full py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:brightness-110 transition">
            {qIdx < total - 1 ? t("widget.quiz.next") : t("widget.quiz.result")}
          </button>
        )}
      </div>
    </BaseWidget>
  );
}
