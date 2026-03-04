import React from 'react';
import './GameGrid.css';

const GameGrid = ({
    games = [],
    onGameSelect,
    variant = 'default',
    size = 'medium',
    columns = 3,
    className = '',
    ...props
}) => {
    const baseClass = `game-grid game-grid--${variant} game-grid--${size}`;
    const gridStyle = {
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        ...props.style
    };

    return (
        <div
            className={`${baseClass} ${className}`}
            style={gridStyle}
            {...props}
        >
            {games.map((game, idx) => (
                <GameCard
                    key={game.value || idx}
                    game={game}
                    onClick={() => onGameSelect && onGameSelect(game)}
                    variant={variant}
                    size={size}
                />
            ))}
        </div>
    );
};

const GameCard = ({ game, onClick, variant, size }) => {
    const isAvailable = game.value === 'dots-boxes' || game.value === 'tic-tac-toe' || game.value === 'sea-battle-2';
    const cardClass = `game-card game-card--${variant} game-card--${size}`;
    const modifierClasses = [
        isAvailable ? 'game-card--available' : 'game-card--disabled'
    ].join(' ');

    return (
        <div
            className={`${cardClass} ${modifierClasses}`}
            onClick={isAvailable ? onClick : undefined}
            style={{
                cursor: isAvailable ? 'pointer' : 'not-allowed',
                opacity: isAvailable ? 1 : 0.6,
            }}
        >
            <div className="game-card__icon">
                {game.icon}
            </div>
            <div className="game-card__label">
                {game.label}
            </div>
            {!isAvailable && (
                <div className="game-card__badge">
                    Próximamente
                </div>
            )}
        </div>
    );
};

export default GameGrid;
