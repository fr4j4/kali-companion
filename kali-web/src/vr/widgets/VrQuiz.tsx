import { useState } from "react";
import { Container, Text } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
import { parseContent } from "../../components/widgets/base/DataWidget";
export function VrQuiz({ ev, onAction }: { ev: ArtifactEvent; onAction?: any }) {
  const { data } = parseContent(ev);
  const qs = ((data as any)?.questions || []) as Array<{ q: string; options?: string[]; answer?: number }>;
  const [sel, setSel] = useState<Record<number, number>>({});
  if (!qs.length) return <Container padding={10}><Text color="#64748b">(quiz vacio)</Text></Container>;
  return (
    <Container flexDirection="column" padding={8} gap={8}>
      <Text fontSize={10} color="#a78bfa" fontWeight={700}>Quiz · toca una opción</Text>
      {qs.slice(0, 3).map((qq, i) => {
        const picked = sel[i];
        const correct = qq.answer;
        return (
          <Container key={i} flexDirection="column" gap={4} padding={8} backgroundColor="#1e293b" borderRadius={6}>
            <Text fontSize={11} color="#e2e8f0">{i + 1}. {qq.q}</Text>
            {(qq.options || []).map((o, j) => {
              const isPicked = picked === j;
              const isCorrect = correct !== undefined && picked !== undefined && j === correct;
              const isWrong = isPicked && correct !== undefined && j !== correct;
              let bg = "#0f172a"; let border = "#334155";
              if (isPicked) bg = "#334155";
              if (isCorrect) { bg = "#14532d"; border = "#22c55e"; }
              if (isWrong) { bg = "#7f1d1d"; border = "#fb7185"; }
              return (
                <Container key={j} flexDirection="row" gap={6} padding={8} backgroundColor={bg} borderRadius={6} borderWidth={1} borderColor={border} hover={{ backgroundColor: isPicked ? bg : "#1e293b" }} onClick={() => { setSel(s => ({ ...s, [i]: j })); onAction?.("quiz", { q: i, o: j }); }}>
                  <Container width={16} height={16} borderRadius={8} backgroundColor={isPicked ? "#38bdf8" : "transparent"} borderWidth={1} borderColor="#64748b" alignItems="center" justifyContent="center">
                    {isPicked && <Text fontSize={8} color="#020617">•</Text>}
                  </Container>
                  <Text fontSize={10} color="#e2e8f0" flexGrow={1}>{o}</Text>
                  {isCorrect && <Text fontSize={10} color="#22c55e">✓</Text>}
                  {isWrong && <Text fontSize={10} color="#fb7185">✗</Text>}
                </Container>
              );
            })}
            {picked !== undefined && correct !== undefined && <Text fontSize={9} color={picked === correct ? "#22c55e" : "#fb7185"}>{picked === correct ? "¡Correcto!" : "Intenta otra"}</Text>}
          </Container>
        );
      })}
    </Container>
  );
}
