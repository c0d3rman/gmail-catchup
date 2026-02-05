import { motion, AnimatePresence } from 'framer-motion';
import type { SenderGroup } from '../types/gmail';
import styles from './TodoSidebar.module.css';

interface TodoSidebarProps {
  todos: SenderGroup[];
  isOpen: boolean;
  onClose: () => void;
  onTodoClick: (group: SenderGroup) => void;
  onRemoveTodo: (group: SenderGroup) => void;
}

export function TodoSidebar({ todos, isOpen, onClose, onTodoClick, onRemoveTodo }: TodoSidebarProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className={styles.sidebar}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className={styles.header}>
              <h3>Todo List</h3>
              <button onClick={onClose} className={styles.closeButton}>
                ×
              </button>
            </div>
            <div className={styles.list}>
              {todos.map(group => (
                <div key={group.senderEmail} className={styles.item}>
                  <button
                    className={styles.itemContent}
                    onClick={() => onTodoClick(group)}
                  >
                    <span className={styles.senderName}>{group.senderName}</span>
                    <span className={styles.emailCount}>
                      {group.emails.length} email{group.emails.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                  <button
                    className={styles.removeButton}
                    onClick={() => onRemoveTodo(group)}
                    aria-label="Remove from todo"
                  >
                    ×
                  </button>
                </div>
              ))}
              {todos.length === 0 && (
                <p className={styles.empty}>No items in todo list</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
