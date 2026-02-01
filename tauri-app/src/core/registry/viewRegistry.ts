export interface ViewRegistration {
  id: string;
  name: string;
  component: React.ComponentType<any>;
  capabilityIds: string[];
}

const views = new Map<string, ViewRegistration>();

export const viewRegistry = {
  register(view: ViewRegistration): void {
    views.set(view.id, view);
  },

  get(id: string): ViewRegistration | undefined {
    return views.get(id);
  },

  getAll(): ViewRegistration[] {
    return Array.from(views.values());
  },

  has(id: string): boolean {
    return views.has(id);
  },
};
