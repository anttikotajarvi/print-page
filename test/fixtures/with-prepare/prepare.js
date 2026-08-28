export default async function prepare(input) {
  return {
    ...input,
    label: `${input.width} × ${input.height} mm`,
  };
}
