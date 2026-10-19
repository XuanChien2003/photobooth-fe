export function TableHeading({
  icon: Icon,
  children,
  scope = "col",
  ...props
}) {
  return (
    <th scope={scope} {...props}>
      <span className="admin-table-heading">
        <Icon size={15} aria-hidden="true" />
        {children}
      </span>
    </th>
  );
}
