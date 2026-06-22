interface EmptyOrListProps {
  empty: string;
  items: string[];
}

export function EmptyOrList({ empty, items }: EmptyOrListProps) {
  if (items.length === 0) {
    return <p className="emptyState">{empty}</p>;
  }
  return (
    <ul className="itemList">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
